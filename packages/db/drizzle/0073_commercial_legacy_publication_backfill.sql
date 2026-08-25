UPDATE "commercial_plans" AS plan
SET
	"description" = CASE plan."slug"
		WHEN 'operacao' THEN 'O núcleo completo para uma unidade funcionar sem remendos.'
		WHEN 'crescimento' THEN 'Canais próprios e relacionamento para vender com recorrência.'
		WHEN 'rede' THEN 'Controle central para operações com mais de uma unidade.'
		ELSE plan."description"
	END,
	"features" = CASE plan."slug"
		WHEN 'operacao' THEN '["Salão, balcão, caixa e KDS", "QR na mesa e hub offline", "Estoque, compras e financeiro", "Usuários e dispositivos ilimitados"]'::jsonb
		WHEN 'crescimento' THEN '["Tudo do plano Operação", "Delivery e retirada próprios", "Fidelidade, cupons e campanhas", "Conciliação, automações e integrações"]'::jsonb
		WHEN 'rede' THEN '["Tudo do plano Crescimento", "Até 3 unidades", "Gestão consolidada e auditoria", "API, webhooks e suporte prioritário"]'::jsonb
		ELSE plan."features"
	END,
	"featured" = plan."slug" = 'crescimento',
	"display_order" = CASE plan."slug" WHEN 'operacao' THEN 1 WHEN 'crescimento' THEN 2 WHEN 'rede' THEN 3 ELSE plan."display_order" END,
	"cta_label" = 'Testar este plano',
	"cta_href" = '/teste-gratis?plano=' || plan."slug",
	"updated_at" = now()
FROM "commercial_catalog_versions" AS catalog
WHERE plan."catalog_version_id" = catalog."id"
	AND catalog."status" = 'published'
	AND catalog."landing" = '{}'::jsonb
	AND plan."slug" IN ('operacao', 'crescimento', 'rede');--> statement-breakpoint

UPDATE "commercial_catalog_versions"
SET
	"landing" = $landing$
{
  "hero": {
    "eyebrow": "Gestão operacional para food service",
    "title": "O salão gira. A gestão acompanha.",
    "description": "Pedidos, produção, estoque, caixa e decisões conectados em uma operação feita para o ritmo real do seu negócio.",
    "primaryCtaLabel": "Testar 14 dias grátis",
    "primaryCtaHref": "/teste-gratis",
    "secondaryCtaLabel": "Conhecer o produto",
    "secondaryCtaHref": "/#produto"
  },
  "socialProof": {
    "title": "Uma base para diferentes operações",
    "items": [
      { "label": "Segmento", "value": "Restaurante" },
      { "label": "Segmento", "value": "Bar" },
      { "label": "Segmento", "value": "Lanchonete" },
      { "label": "Segmento", "value": "Cafeteria" },
      { "label": "Segmento", "value": "Pizzaria" },
      { "label": "Estrutura", "value": "Operação em rede" }
    ]
  },
  "benefits": {
    "title": "Menos improviso. Mais controle.",
    "items": [
      { "title": "Atendimento sem atrito", "description": "Mesas, comandas, balcão, divisão de conta e QR conversam com o mesmo pedido.", "icon": "operations" },
      { "title": "Produção no ritmo", "description": "KDS por estação, impressão e prioridades ajudam cozinha e bar a trabalhar com contexto.", "icon": "operations" },
      { "title": "Estoque conectado", "description": "Fichas técnicas transformam vendas em consumo e tornam rupturas e perdas visíveis.", "icon": "insights" },
      { "title": "Caixa responsável", "description": "Turnos, aprovações, pagamentos e conciliação preservam uma trilha auditável.", "icon": "finance" },
      { "title": "Gestão acionável", "description": "Indicadores começam nas exceções que pedem decisão, não em gráficos decorativos.", "icon": "growth" },
      { "title": "Continuidade local", "description": "O hub planejado mantém a operação essencial da unidade durante falhas de internet.", "icon": "security" }
    ]
  },
  "howItWorks": {
    "title": "O teste começa quando a casa está pronta.",
    "steps": [
      { "title": "Entendemos a operação", "description": "Unidade, canais, equipe, equipamentos e necessidades fiscais." },
      { "title": "Configuramos a base", "description": "Cardápio, mesas, produção, usuários, caixa e permissões." },
      { "title": "Simulamos o turno", "description": "Pedido, produção, pagamento, emissão e fechamento antes da ativação." },
      { "title": "Ativamos os 14 dias", "description": "O período gratuito começa após a aprovação operacional." }
    ]
  },
  "testimonials": {
    "title": "Promessas só depois de homologadas.",
    "items": []
  },
  "faq": {
    "title": "Antes de começar",
    "items": [
      { "question": "Preciso cadastrar cartão para testar?", "answer": "Não. O teste assistido de 14 dias não exige cartão e só começa após a ativação da operação." },
      { "question": "O GiroMesa funciona sem internet?", "answer": "A continuidade offline depende do aplicativo e hub local. Ela será disponibilizada comercialmente somente após a homologação do piloto." },
      { "question": "Emissão fiscal está incluída?", "answer": "Não. O módulo fiscal é adicional por unidade, e a contratação exige configuração fiscal ou declaração de emissor externo." },
      { "question": "Posso usar em várias unidades?", "answer": "Sim. O plano Rede parte de até três unidades e oferece visão consolidada." },
      { "question": "Vocês ajudam na configuração?", "answer": "O onboarding e treinamento remoto fazem parte da ativação. Instalações presenciais, rede e equipamentos podem ser cobrados à parte." }
    ]
  },
  "finalCta": {
    "title": "Uma operação que gira sem perder o controle.",
    "description": "Organize a ativação do GiroMesa com acompanhamento da nossa equipe.",
    "ctaLabel": "Solicitar teste assistido",
    "ctaHref": "/teste-gratis"
  },
  "legal": {
    "terms": {
      "version": "preliminar-2026-08",
      "effectiveAt": "2026-08-25T00:00:00.000Z",
      "title": "Termos de Uso",
      "sections": [
        { "heading": "Status do documento", "body": "Esta é a versão informativa vigente no lançamento técnico e permanece sujeita a revisão jurídica antes da publicação comercial definitiva." },
        { "heading": "1. Objeto", "body": "O GiroMesa é uma plataforma de apoio à gestão de operações de food service. Funcionalidades contratadas, limites e serviços adicionais serão descritos na proposta e no catálogo comercial vigente." },
        { "heading": "2. Conta e responsabilidades", "body": "O responsável deve manter dados corretos, proteger credenciais, configurar permissões e usar o serviço conforme a legislação aplicável. Ações sensíveis podem exigir aprovação adicional e ficam sujeitas a auditoria." },
        { "heading": "3. Integrações", "body": "Serviços de pagamento, emissão fiscal, mensageria e terceiros dependem de contratos, credenciais, disponibilidade e homologação próprias. A contratação do GiroMesa não substitui obrigações com esses provedores." },
        { "heading": "4. Teste e cobrança", "body": "O teste assistido dura 14 dias após a ativação operacional e não exige cartão. Assinaturas, reajustes, cancelamento, retenção e exportação serão apresentados antes da contratação." },
        { "heading": "5. Continuidade e suporte", "body": "Metas de atendimento e disponibilidade serão as vigentes no plano contratado. Incidentes, manutenção e limitações externas serão comunicados pelos canais oficiais." },
        { "heading": "6. Cancelamento", "body": "O cancelamento não implica exclusão imediata. O cliente poderá solicitar exportação e eliminação conforme contrato, obrigações legais e política de retenção." }
      ]
    },
    "privacy": {
      "version": "preliminar-2026-08",
      "effectiveAt": "2026-08-25T00:00:00.000Z",
      "title": "Política de Privacidade",
      "sections": [
        { "heading": "Status do documento", "body": "Documento informativo vigente no lançamento técnico, sujeito a revisão jurídica e à definição final do controlador, operador, encarregado e prazos de retenção." },
        { "heading": "1. Dados tratados", "body": "Podemos tratar dados cadastrais, profissionais, de autenticação, dispositivos, atendimento, uso do produto e informações operacionais inseridas pelo cliente." },
        { "heading": "2. Finalidades", "body": "Usamos os dados para prestar e proteger o serviço, autenticar pessoas, oferecer suporte, cumprir obrigações, auditar ações e melhorar o produto dentro das bases legais aplicáveis." },
        { "heading": "3. Compartilhamento", "body": "Dados podem ser compartilhados com infraestrutura e provedores contratados na medida necessária. Integrações ativadas pelo cliente seguem também os termos dos respectivos terceiros." },
        { "heading": "4. Segurança e retenção", "body": "Aplicamos controle de acesso, segregação entre organizações, criptografia adequada, auditoria e rotinas de backup. Prazos de retenção considerarão contrato, finalidade e obrigações legais." },
        { "heading": "5. Direitos do titular", "body": "Solicitações de confirmação, acesso, correção, portabilidade, oposição ou eliminação terão canal específico antes do lançamento comercial." },
        { "heading": "6. Cookies", "body": "Usaremos cookies necessários para segurança e sessão. Métricas ou publicidade não essenciais dependerão de transparência e consentimento quando exigido." }
      ]
    }
  }
}
$landing$::jsonb,
	"seo" = $seo$
{
  "title": "GiroMesa | Gestão para food service",
  "description": "Salão, balcão, produção, estoque e gestão conectados em uma só operação.",
  "canonicalPath": "/"
}
$seo$::jsonb,
	"updated_at" = now()
WHERE "status" = 'published'
	AND "landing" = '{}'::jsonb
	AND "seo" = '{}'::jsonb;
