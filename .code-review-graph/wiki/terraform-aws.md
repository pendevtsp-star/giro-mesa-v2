# terraform-aws

## Overview

Directory-based community: infra/terraform

- **Size**: 41 nodes
- **Cohesion**: 0.5816
- **Dominant Language**: hcl

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| provider.registry.terraform.io/hashicorp/aws | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/.terraform.lock.hcl | 4-27 |
| data.aws_availability_zones.available | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 1-3 |
| resource.aws_vpc.main | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 5-9 |
| resource.aws_internet_gateway.main | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 11-13 |
| resource.aws_subnet.public | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 15-21 |
| resource.aws_subnet.private | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 23-28 |
| resource.aws_eip.nat | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 30-32 |
| resource.aws_nat_gateway.main | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 34-38 |
| resource.aws_route_table.public | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 40-46 |
| resource.aws_route_table.private | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 48-54 |
| resource.aws_route_table_association.public | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 56-60 |
| resource.aws_route_table_association.private | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 62-66 |
| resource.aws_security_group.database | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 68-72 |
| resource.aws_security_group.application | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 74-78 |
| resource.aws_vpc_security_group_egress_rule.application_https | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 82-89 |
| resource.aws_vpc_security_group_ingress_rule.database_from_application | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 91-98 |
| resource.aws_vpc_security_group_egress_rule.application_to_database | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf | 100-107 |
| output.vpc_id | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/outputs.tf | 1-3 |
| output.ecs_cluster_name | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/outputs.tf | 5-7 |
| output.ecr_repository_urls | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/outputs.tf | 9-11 |
| output.database_endpoint | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/outputs.tf | 13-16 |
| output.objects_bucket | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/outputs.tf | 18-20 |
| resource.aws_ecs_cluster.main | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 1-8 |
| resource.aws_ecr_repository.services | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 10-18 |
| resource.aws_cloudwatch_log_group.services | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 20-24 |
| resource.aws_s3_bucket.objects | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 26-28 |
| resource.aws_kms_key.objects | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 30-34 |
| resource.aws_kms_alias.objects | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 36-39 |
| resource.aws_s3_bucket_versioning.objects | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 41-46 |
| resource.aws_s3_bucket_server_side_encryption_configuration.objects | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 48-57 |
| resource.aws_s3_bucket_public_access_block.objects | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 59-65 |
| resource.aws_db_subnet_group.main | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 67-70 |
| resource.aws_db_instance.postgres | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 72-95 |
| resource.aws_secretsmanager_secret.application | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf | 97-100 |
| var.aws_region | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/variables.tf | 1-5 |
| var.environment | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/variables.tf | 7-11 |
| var.vpc_cidr | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/variables.tf | 13-17 |
| var.database_instance_class | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/variables.tf | 19-23 |
| var.database_multi_az | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/variables.tf | 25-29 |
| var.database_deletion_protection | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/variables.tf | 31-35 |
| provider.aws | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/versions.tf | 12-22 |

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Incoming

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/network.tf` (16 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/platform.tf` (12 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/variables.tf` (6 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/outputs.tf` (5 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/.terraform.lock.hcl` (1 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/infra/terraform/versions.tf` (1 edge(s))
