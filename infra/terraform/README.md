# Infraestrutura AWS

Baseline gerenciado para `sa-east-1`: VPC, sub-redes públicas/privadas, NAT, ECS, ECR, RDS PostgreSQL, S3, Secrets Manager e CloudWatch.

O Terraform não cria serviços ECS, domínio, certificado ou DNS antes de existirem imagens e contas externas. Para produção, forneça backend remoto do state, habilite Multi-AZ e revise custos/limites da conta.

Nunca aplique este diretório usando credenciais pessoais persistentes; CI deve assumir uma role AWS por OIDC.
