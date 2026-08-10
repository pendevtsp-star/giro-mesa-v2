variable "aws_region" {
  type        = string
  description = "Primary Brazil region."
  default     = "sa-east-1"
}

variable "environment" {
  type        = string
  description = "Environment name."
  default     = "pilot"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR."
  default     = "10.42.0.0/16"
}

variable "database_instance_class" {
  type        = string
  description = "RDS instance class."
  default     = "db.t4g.micro"
}

variable "database_multi_az" {
  type        = bool
  description = "Enable Multi-AZ before general availability."
  default     = false
}

variable "database_deletion_protection" {
  type        = bool
  description = "Protect production databases from deletion."
  default     = true
}
