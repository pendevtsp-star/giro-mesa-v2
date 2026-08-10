resource "aws_ecs_cluster" "main" {
  name = "giromesa-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecr_repository" "services" {
  for_each             = toset(["api", "worker", "site", "customer"])
  name                 = "giromesa/${var.environment}/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_cloudwatch_log_group" "services" {
  for_each          = aws_ecr_repository.services
  name              = "/giromesa/${var.environment}/${each.key}"
  retention_in_days = 30
}

resource "aws_s3_bucket" "objects" {
  bucket_prefix = "giromesa-${var.environment}-objects-"
}

resource "aws_s3_bucket_versioning" "objects" {
  bucket = aws_s3_bucket.objects.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "objects" {
  bucket = aws_s3_bucket.objects.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "objects" {
  bucket                  = aws_s3_bucket.objects.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_db_subnet_group" "main" {
  name       = "giromesa-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "postgres" {
  identifier                  = "giromesa-${var.environment}"
  engine                      = "postgres"
  engine_version              = "17"
  instance_class              = var.database_instance_class
  allocated_storage           = 20
  max_allocated_storage       = 100
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "giromesa"
  username                    = "giromesa_admin"
  manage_master_user_password = true
  port                        = 5432
  multi_az                    = var.database_multi_az
  publicly_accessible         = false
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  backup_retention_period     = 14
  deletion_protection         = var.database_deletion_protection
  skip_final_snapshot         = false
  final_snapshot_identifier   = "giromesa-${var.environment}-final"
  auto_minor_version_upgrade  = true
  apply_immediately           = false
}

resource "aws_secretsmanager_secret" "application" {
  name_prefix             = "giromesa/${var.environment}/application-"
  recovery_window_in_days = 30
}
