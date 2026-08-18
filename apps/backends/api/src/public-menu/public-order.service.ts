import { randomUUID } from "node:crypto";
import type { PublicOrderInput } from "@giromesa/contracts";
import {
  auditEvents,
  deliveryOrderStatusHistory,
  deliveryOrders,
  deliveryZones,
  identities,
  outboxEvents,
  posCatalogPromotions,
  posIdempotencyReceipts,
  posKdsTicketItems,
  posKdsTickets,
  posModifierGroups,
  posModifierOptions,
  posOrderItemModifiers,
  posOrderItems,
  posOrders,
  posProductAvailability,
  posProductModifierGroups,
  posProductPrices,
  posProductStations,
  posProducts,
  posTabEvents,
  posTabs,
  publicMenus,
  units,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { deliveryCoverageStatus } from "../growth/growth.rules.js";
import {
  isWithinAvailability,
  itemAmounts,
  replayResult,
  requestHash,
} from "../pilot-operations/pilot-rules.js";
import { bestPromotion, localCalendar, localDate } from "./public-order-rules.js";

const PUBLIC_ORDER_OPERATION = "public-order.create";

type PublicOrderResponse = {
  protocol: string;
  status: "placed";
  fulfillment: "delivery" | "pickup";
  payment: { method: "pay_on_fulfillment"; status: "awaiting_payment" };
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  addressValidationStatus: "covered" | "unchecked" | "unavailable";
  idempotentReplay?: boolean;
};

@Injectable()
export class PublicOrderService {
  constructor(private readonly database: DatabaseService) {}

  async options(slug: string) {
    const menu = await this.activeMenu(slug);
    const zones = await this.database.db
      .select({
        name: deliveryZones.name,
        feeCents: deliveryZones.feeCents,
        minimumOrderCents: deliveryZones.minimumOrderCents,
        estimatedDeliveryMinutes: deliveryZones.estimatedDeliveryMinutes,
      })
      .from(deliveryZones)
      .where(
        and(
          eq(deliveryZones.organizationId, menu.organizationId),
          eq(deliveryZones.unitId, menu.unitId),
          eq(deliveryZones.active, true),
        ),
      )
      .orderBy(deliveryZones.name);
    return {
      fulfillment: { pickup: true, delivery: zones.length > 0 },
      deliveryZones: zones,
      payment: {
        method: "pay_on_fulfillment" as const,
        status: "awaiting_payment" as const,
        label: "Pagamento na retirada ou na entrega",
      },
    };
  }

  async place(slug: string, idempotencyKey: string, input: PublicOrderInput) {
    const normalizedKey = idempotencyKey.trim();
    const fingerprint = requestHash(PUBLIC_ORDER_OPERATION, input);
    return this.database.db.transaction(async (tx) => {
      const [menu] = await tx
        .select({
          organizationId: publicMenus.organizationId,
          unitId: publicMenus.unitId,
          items: publicMenus.items,
          active: publicMenus.active,
          publishedAt: publicMenus.publishedAt,
          unitActive: units.active,
          timezone: units.timezone,
        })
        .from(publicMenus)
        .innerJoin(
          units,
          and(
            eq(units.organizationId, publicMenus.organizationId),
            eq(units.id, publicMenus.unitId),
          ),
        )
        .where(eq(publicMenus.slug, slug))
        .limit(1);
      if (!menu) this.notFound();

      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`public-order:${menu.organizationId}:${menu.unitId}:${normalizedKey}`}))`,
      );
      const [existingReceipt] = await tx
        .select({
          operation: posIdempotencyReceipts.operation,
          requestHash: posIdempotencyReceipts.requestHash,
          response: posIdempotencyReceipts.response,
        })
        .from(posIdempotencyReceipts)
        .where(
          and(
            eq(posIdempotencyReceipts.organizationId, menu.organizationId),
            eq(posIdempotencyReceipts.unitId, menu.unitId),
            eq(posIdempotencyReceipts.key, normalizedKey),
          ),
        )
        .limit(1);
      const replay = replayResult<PublicOrderResponse>(
        existingReceipt,
        PUBLIC_ORDER_OPERATION,
        fingerprint,
      );
      if (replay) return replay;

      if (!menu.active || !menu.publishedAt || !menu.unitActive) this.notFound();
      const now = new Date();
      const promotions = await tx
        .select({
          id: posCatalogPromotions.id,
          discountType: posCatalogPromotions.discountType,
          discountValue: posCatalogPromotions.discountValue,
          productIds: posCatalogPromotions.productIds,
          categoryIds: posCatalogPromotions.categoryIds,
          channels: posCatalogPromotions.channels,
          daysOfWeek: posCatalogPromotions.daysOfWeek,
          startTime: posCatalogPromotions.startTime,
          endTime: posCatalogPromotions.endTime,
        })
        .from(posCatalogPromotions)
        .where(
          and(
            eq(posCatalogPromotions.organizationId, menu.organizationId),
            eq(posCatalogPromotions.unitId, menu.unitId),
            eq(posCatalogPromotions.active, true),
            or(isNull(posCatalogPromotions.startsAt), lte(posCatalogPromotions.startsAt, now)),
            or(isNull(posCatalogPromotions.endsAt), gt(posCatalogPromotions.endsAt, now)),
          ),
        );
      const local = localCalendar(now, menu.timezone);
      const stockDate = localDate(now, menu.timezone);
      const actorIdentityId = await this.serviceIdentity(tx, menu.organizationId);
      const publicProductIds = new Set(
        menu.items.flatMap((item) =>
          typeof item === "object" && item !== null && typeof item.id === "string" ? [item.id] : [],
        ),
      );
      const createdItems: Array<{ id: string; stationId: string }> = [];
      const ticketIds: string[] = [];
      const preparedItems = [];
      let subtotalCents = 0;
      let grossSubtotalCents = 0;
      let discountCents = 0;
      const promotionIds = new Set<string>();

      for (const item of input.items) {
        if (!publicProductIds.has(item.productId)) {
          throw new BadRequestException({
            code: "PUBLIC_PRODUCT_NOT_IN_MENU",
            message: "Um item não pertence ao cardápio publicado.",
          });
        }
        const [product] = await tx
          .select({
            id: posProducts.id,
            categoryId: posProducts.categoryId,
            name: posProducts.name,
            priceCents: posProductPrices.priceCents,
            deliveryPriceCents: posProductPrices.deliveryPriceCents,
            available: posProductAvailability.available,
            schedule: posProductAvailability.schedule,
            autoDeductStock: posProductAvailability.autoDeductStock,
            stationId: posProductStations.stationId,
          })
          .from(posProducts)
          .innerJoin(
            posProductPrices,
            and(
              eq(posProductPrices.organizationId, posProducts.organizationId),
              eq(posProductPrices.productId, posProducts.id),
              eq(posProductPrices.unitId, menu.unitId),
            ),
          )
          .innerJoin(
            posProductAvailability,
            and(
              eq(posProductAvailability.organizationId, posProducts.organizationId),
              eq(posProductAvailability.productId, posProducts.id),
              eq(posProductAvailability.unitId, menu.unitId),
            ),
          )
          .innerJoin(
            posProductStations,
            and(
              eq(posProductStations.organizationId, posProducts.organizationId),
              eq(posProductStations.productId, posProducts.id),
              eq(posProductStations.unitId, menu.unitId),
            ),
          )
          .where(
            and(
              eq(posProducts.organizationId, menu.organizationId),
              eq(posProducts.id, item.productId),
              eq(posProducts.active, true),
            ),
          )
          .limit(1);
        if (!product?.available || !isWithinAvailability(product.schedule, now, menu.timezone)) {
          throw new ConflictException({
            code: "PUBLIC_PRODUCT_UNAVAILABLE",
            message: "Um item não está disponível neste horário.",
          });
        }

        const optionIds = [...new Set(item.modifierOptionIds)];
        const options =
          optionIds.length === 0
            ? []
            : await tx
                .select({
                  id: posModifierOptions.id,
                  name: posModifierOptions.name,
                  groupId: posModifierOptions.groupId,
                  priceDeltaCents: posModifierOptions.priceDeltaCents,
                })
                .from(posModifierOptions)
                .innerJoin(
                  posProductModifierGroups,
                  and(
                    eq(posProductModifierGroups.organizationId, posModifierOptions.organizationId),
                    eq(posProductModifierGroups.groupId, posModifierOptions.groupId),
                    eq(posProductModifierGroups.productId, item.productId),
                  ),
                )
                .where(
                  and(
                    eq(posModifierOptions.organizationId, menu.organizationId),
                    eq(posModifierOptions.active, true),
                    inArray(posModifierOptions.id, optionIds),
                  ),
                );
        if (options.length !== optionIds.length) {
          throw new BadRequestException({
            code: "PUBLIC_MODIFIER_INVALID",
            message: "Uma opção selecionada não pertence ao produto.",
          });
        }
        const groups = await tx
          .select({
            id: posModifierGroups.id,
            minimum: posModifierGroups.minimumSelections,
            maximum: posModifierGroups.maximumSelections,
          })
          .from(posProductModifierGroups)
          .innerJoin(
            posModifierGroups,
            and(
              eq(posModifierGroups.organizationId, posProductModifierGroups.organizationId),
              eq(posModifierGroups.id, posProductModifierGroups.groupId),
            ),
          )
          .where(
            and(
              eq(posProductModifierGroups.organizationId, menu.organizationId),
              eq(posProductModifierGroups.productId, item.productId),
              eq(posModifierGroups.active, true),
            ),
          );
        for (const group of groups) {
          const count = options.filter((option) => option.groupId === group.id).length;
          if (count < group.minimum || count > group.maximum) {
            throw new BadRequestException({
              code: "PUBLIC_MODIFIER_RANGE",
              message: "Revise as opções obrigatórias do produto.",
            });
          }
        }
        const modifierPerUnitCents = options.reduce(
          (sum, option) => sum + option.priceDeltaCents,
          0,
        );
        const unitPriceCents =
          input.fulfillment === "delivery" && product.deliveryPriceCents !== null
            ? product.deliveryPriceCents
            : product.priceCents;
        const promotion = bestPromotion(
          promotions,
          item.productId,
          product.categoryId,
          input.fulfillment,
          local.weekday,
          local.minute,
          unitPriceCents,
          item.quantity,
        );
        const amounts = itemAmounts(
          item.quantity,
          unitPriceCents,
          modifierPerUnitCents,
          promotion?.discountCents ?? 0,
        );
        if (product.autoDeductStock) {
          const [reserved] = await tx
            .update(posProductAvailability)
            .set({
              soldToday: sql`case when ${posProductAvailability.stockDate} = ${stockDate} then ${posProductAvailability.soldToday} + ${item.quantity} else ${item.quantity} end`,
              stockDate,
              updatedAt: now,
            })
            .where(
              and(
                eq(posProductAvailability.organizationId, menu.organizationId),
                eq(posProductAvailability.unitId, menu.unitId),
                eq(posProductAvailability.productId, item.productId),
                eq(posProductAvailability.autoDeductStock, true),
                or(
                  isNull(posProductAvailability.dailyStock),
                  sql`(case when ${posProductAvailability.stockDate} = ${stockDate} then ${posProductAvailability.soldToday} else 0 end) + ${item.quantity} <= ${posProductAvailability.dailyStock}`,
                ),
              ),
            )
            .returning({ productId: posProductAvailability.productId });
          if (!reserved) {
            throw new ConflictException({
              code: "PUBLIC_PRODUCT_STOCK_EXHAUSTED",
              message: "A quantidade solicitada não está mais disponível.",
            });
          }
        }
        if (promotion) promotionIds.add(promotion.id);
        grossSubtotalCents += amounts.grossCents;
        discountCents += amounts.discountCents;
        subtotalCents += amounts.netCents;
        if (![grossSubtotalCents, discountCents, subtotalCents].every(Number.isSafeInteger)) {
          throw new BadRequestException({ code: "PUBLIC_ORDER_TOTAL_INVALID" });
        }
        preparedItems.push({
          input: item,
          product,
          options,
          amounts,
          modifierPerUnitCents,
          unitPriceCents,
        });
      }

      let zoneId: string | null = null;
      let deliveryFeeCents = 0;
      let promisedAt: Date | null = null;
      let addressValidationStatus: "covered" | "unchecked" | "unavailable" = "unchecked";
      if (input.fulfillment === "delivery") {
        const [zone] = await tx
          .select({
            id: deliveryZones.id,
            feeCents: deliveryZones.feeCents,
            minimumOrderCents: deliveryZones.minimumOrderCents,
            estimatedDeliveryMinutes: deliveryZones.estimatedDeliveryMinutes,
            geometry: deliveryZones.geometry,
          })
          .from(deliveryZones)
          .where(
            and(
              eq(deliveryZones.organizationId, menu.organizationId),
              eq(deliveryZones.unitId, menu.unitId),
              eq(deliveryZones.name, input.deliveryZone ?? ""),
              eq(deliveryZones.active, true),
            ),
          )
          .limit(1);
        if (!zone) {
          throw new BadRequestException({
            code: "PUBLIC_DELIVERY_ZONE_INVALID",
            message: "A zona de entrega não está disponível.",
          });
        }
        if (subtotalCents < zone.minimumOrderCents) {
          throw new BadRequestException({
            code: "PUBLIC_DELIVERY_MINIMUM_NOT_MET",
            message: "O pedido não atingiu o valor mínimo da zona.",
          });
        }
        zoneId = zone.id;
        deliveryFeeCents = zone.feeCents;
        promisedAt = new Date(now.getTime() + zone.estimatedDeliveryMinutes * 60_000);
        const coverage = deliveryCoverageStatus(zone.geometry, input.address);
        if (coverage === "outside")
          throw new BadRequestException({
            code: "PUBLIC_DELIVERY_ADDRESS_OUTSIDE_ZONE",
            message: "Endereço fora da zona de entrega.",
          });
        addressValidationStatus = coverage;
      }
      const totalCents = subtotalCents + deliveryFeeCents;
      if (!Number.isSafeInteger(totalCents)) {
        throw new BadRequestException({ code: "PUBLIC_ORDER_TOTAL_INVALID" });
      }
      const protocol = this.protocol();
      const [tab] = await tx
        .insert(posTabs)
        .values({
          organizationId: menu.organizationId,
          unitId: menu.unitId,
          openedByIdentityId: actorIdentityId,
          label: `${input.fulfillment === "delivery" ? "Entrega" : "Retirada"} ${protocol}`,
          guestCount: 1,
          subtotalCents: grossSubtotalCents,
          discountCents,
          totalCents: subtotalCents,
        })
        .returning({ id: posTabs.id });
      if (!tab) throw new Error("PUBLIC_TAB_INSERT_FAILED");
      const [order] = await tx
        .insert(posOrders)
        .values({
          organizationId: menu.organizationId,
          unitId: menu.unitId,
          tabId: tab.id,
          createdByIdentityId: actorIdentityId,
          status: "sent",
          sentAt: new Date(),
        })
        .returning({ id: posOrders.id });
      if (!order) throw new Error("PUBLIC_ORDER_INSERT_FAILED");

      for (const prepared of preparedItems) {
        const [created] = await tx
          .insert(posOrderItems)
          .values({
            organizationId: menu.organizationId,
            unitId: menu.unitId,
            orderId: order.id,
            productId: prepared.product.id,
            stationId: prepared.product.stationId,
            productName: prepared.product.name,
            quantity: prepared.input.quantity,
            unitPriceCents: prepared.unitPriceCents,
            modifiersCents: prepared.modifierPerUnitCents * prepared.input.quantity,
            ...prepared.amounts,
            status: "queued",
            notes: prepared.input.notes,
          })
          .returning({ id: posOrderItems.id });
        if (!created) throw new Error("PUBLIC_ORDER_ITEM_INSERT_FAILED");
        createdItems.push({ id: created.id, stationId: prepared.product.stationId });
        if (prepared.options.length > 0) {
          await tx.insert(posOrderItemModifiers).values(
            prepared.options.map((option) => ({
              organizationId: menu.organizationId,
              unitId: menu.unitId,
              orderItemId: created.id,
              optionId: option.id,
              name: option.name,
              unitDeltaCents: option.priceDeltaCents,
              totalDeltaCents: option.priceDeltaCents * prepared.input.quantity,
            })),
          );
        }
      }

      for (const stationId of new Set(createdItems.map((item) => item.stationId))) {
        const [ticket] = await tx
          .insert(posKdsTickets)
          .values({
            organizationId: menu.organizationId,
            unitId: menu.unitId,
            orderId: order.id,
            stationId,
          })
          .returning({ id: posKdsTickets.id });
        if (!ticket) throw new Error("PUBLIC_KDS_TICKET_INSERT_FAILED");
        ticketIds.push(ticket.id);
        await tx.insert(posKdsTicketItems).values(
          createdItems
            .filter((item) => item.stationId === stationId)
            .map((item) => ({
              organizationId: menu.organizationId,
              unitId: menu.unitId,
              ticketId: ticket.id,
              orderItemId: item.id,
            })),
        );
      }

      const normalizedAddress = input.address
        ? { ...input.address, postalCode: input.address.postalCode.replace(/\D/g, "") }
        : null;
      const [delivery] = await tx
        .insert(deliveryOrders)
        .values({
          organizationId: menu.organizationId,
          unitId: menu.unitId,
          zoneId,
          orderRef: tab.id,
          publicProtocol: protocol,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          fulfillment: input.fulfillment,
          status: "placed",
          subtotalCents,
          deliveryFeeCents,
          totalCents,
          paymentMethod: "pay_on_fulfillment",
          paymentStatus: "awaiting_payment",
          address: normalizedAddress,
          addressValidationStatus,
          promisedAt,
          idempotencyKey: normalizedKey,
          requestFingerprint: fingerprint,
        })
        .returning({ id: deliveryOrders.id });
      if (!delivery) throw new Error("PUBLIC_DELIVERY_ORDER_INSERT_FAILED");
      await tx.insert(deliveryOrderStatusHistory).values({
        organizationId: menu.organizationId,
        unitId: menu.unitId,
        deliveryOrderId: delivery.id,
        toStatus: "placed",
        actorIdentityId,
        metadata: { source: "public_menu" },
      });

      const response: PublicOrderResponse = {
        protocol,
        status: "placed",
        fulfillment: input.fulfillment,
        payment: { method: "pay_on_fulfillment", status: "awaiting_payment" },
        subtotalCents,
        deliveryFeeCents,
        totalCents,
        addressValidationStatus,
      };
      await tx.insert(posTabEvents).values({
        organizationId: menu.organizationId,
        unitId: menu.unitId,
        tabId: tab.id,
        actorIdentityId,
        type: "public_order.placed",
        payload: {
          protocol,
          fulfillment: input.fulfillment,
          orderId: order.id,
          channel: "public_menu",
        },
      });
      await tx.insert(posTabEvents).values({
        organizationId: menu.organizationId,
        unitId: menu.unitId,
        tabId: tab.id,
        actorIdentityId,
        type: "order.sent",
        payload: { orderId: order.id, ticketIds },
      });
      await tx.insert(auditEvents).values({
        organizationId: menu.organizationId,
        unitId: menu.unitId,
        actorIdentityId,
        action: "public_order.created",
        entityType: "growth_delivery_order",
        entityId: delivery.id,
        metadata: {
          protocol,
          fulfillment: input.fulfillment,
          totalCents,
          policyVersion: input.policyVersion,
          promotionIds: [...promotionIds],
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.order.sent",
        aggregateType: "tab",
        aggregateId: tab.id,
        payload: {
          organizationId: menu.organizationId,
          unitId: menu.unitId,
          tabId: tab.id,
          orderId: order.id,
          ticketIds,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "growth.public_order_created",
        aggregateType: "growth_delivery_order",
        aggregateId: delivery.id,
        payload: {
          organizationId: menu.organizationId,
          unitId: menu.unitId,
          deliveryOrderId: delivery.id,
          protocol,
          fulfillment: input.fulfillment,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "growth.delivery_order_created",
        aggregateType: "growth_delivery_order",
        aggregateId: delivery.id,
        payload: {
          organizationId: menu.organizationId,
          unitId: menu.unitId,
          deliveryOrderId: delivery.id,
          fulfillment: input.fulfillment,
          source: "public_menu",
        },
      });
      await tx.insert(posIdempotencyReceipts).values({
        organizationId: menu.organizationId,
        unitId: menu.unitId,
        actorIdentityId,
        key: normalizedKey,
        operation: PUBLIC_ORDER_OPERATION,
        requestHash: fingerprint,
        response,
      });
      return response;
    });
  }

  private async activeMenu(slug: string) {
    const [menu] = await this.database.db
      .select({ organizationId: publicMenus.organizationId, unitId: publicMenus.unitId })
      .from(publicMenus)
      .innerJoin(
        units,
        and(eq(units.organizationId, publicMenus.organizationId), eq(units.id, publicMenus.unitId)),
      )
      .where(
        and(
          eq(publicMenus.slug, slug),
          eq(publicMenus.active, true),
          sql`${publicMenus.publishedAt} is not null`,
          eq(units.active, true),
        ),
      )
      .limit(1);
    if (!menu) this.notFound();
    return menu;
  }

  private async serviceIdentity(
    tx: Parameters<Parameters<typeof this.database.db.transaction>[0]>[0],
    organizationId: string,
  ) {
    const email = `public-orders+${organizationId}@system.giromesa.invalid`;
    await tx
      .insert(identities)
      .values({
        email,
        displayName: "Canal público de pedidos",
        kind: "service",
        emailVerifiedAt: new Date(),
      })
      .onConflictDoNothing();
    const [identity] = await tx
      .select({ id: identities.id, kind: identities.kind })
      .from(identities)
      .where(eq(identities.email, email))
      .limit(1);
    if (identity?.kind !== "service") {
      throw new Error("PUBLIC_ORDER_SERVICE_IDENTITY_UNAVAILABLE");
    }
    return identity.id;
  }

  private protocol() {
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return `GM-${day}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  }

  private notFound(): never {
    throw new NotFoundException({
      code: "PUBLIC_ORDERING_NOT_FOUND",
      message: "Pedidos públicos não estão disponíveis para este cardápio.",
    });
  }
}
