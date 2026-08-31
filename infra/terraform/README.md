# infra/terraform — AWS ap-south-1 (Mumbai)

Scaffold. Modules to add (SAD §9): VPC, ECS Fargate (core-api, admin-api, ai-service,
workers, scheduler), RDS PostgreSQL 16 Multi-AZ + read replica, ElastiCache Redis,
SQS + DLQs, S3 (private, versioned) + CloudFront (signed cookies), Secrets Manager + KMS,
CloudWatch/OTel. DR: cross-region snapshot copies (RPO 15m / RTO 4h).
