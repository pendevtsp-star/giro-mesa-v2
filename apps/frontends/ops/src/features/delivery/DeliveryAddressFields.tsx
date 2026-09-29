import type { DeliveryAddressInput } from "@giromesa/contracts";
import { Input, Label } from "@giromesa/ui";
import "./delivery-address.css";

export const emptyDeliveryAddress: DeliveryAddressInput = {
  street: "",
  number: "",
  neighborhood: "",
  city: "",
  state: "",
  postalCode: "",
};

export function formatDeliveryAddress(address: DeliveryAddressInput) {
  return [
    `${address.street}, ${address.number}`,
    address.complement,
    address.neighborhood,
    `${address.city}/${address.state}`,
    address.postalCode,
    address.reference ? `Referência: ${address.reference}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function DeliveryAddressFields({
  value,
  onChange,
  required = true,
  disabled = false,
}: {
  value: DeliveryAddressInput;
  onChange: (address: DeliveryAddressInput) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="delivery-address-fields">
      {(
        [
          [
            ["postalCode", "CEP", "00000-000", 9],
            ["street", "Rua", "", 180],
            ["number", "Número", "S/N", 30],
            ["complement", "Complemento", "Apartamento, bloco…", 160],
          ],
          [
            ["neighborhood", "Bairro", "", 120],
            ["city", "Cidade", "", 120],
            ["state", "UF", "SP", 2],
            ["reference", "Referência", "Como encontrar o local", 240],
          ],
        ] as const
      ).map((fields, row) => (
        <div
          className={`delivery-address-fields__row delivery-address-fields__row--${row + 1}`}
          key={fields[0][0]}
        >
          {fields.map(([key, label, placeholder, maxLength]) => (
            <Label className={`gm-form-field delivery-address-fields__${key}`} key={key}>
              {label}
              <Input
                autoComplete={
                  {
                    postalCode: "postal-code",
                    street: "address-line1",
                    number: "off",
                    complement: "address-line2",
                    neighborhood: "address-level3",
                    city: "address-level2",
                    state: "address-level1",
                    reference: "off",
                  }[key]
                }
                disabled={disabled}
                inputMode={key === "postalCode" ? "numeric" : "text"}
                maxLength={maxLength}
                onChange={(event) =>
                  onChange({
                    ...value,
                    [key]: key === "state" ? event.target.value.toUpperCase() : event.target.value,
                  })
                }
                placeholder={placeholder}
                required={required && key !== "complement" && key !== "reference"}
                value={value[key] ?? ""}
              />
            </Label>
          ))}
        </div>
      ))}
    </div>
  );
}
