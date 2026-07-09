provider "aws" {
  region = "us-east-1"
}

# --- Networking Core ---
resource "aws_vpc" "prod_vpc" {
  cidr_block = "10.0.0.0/16"
  enable_dns_support = true
  enable_dns_hostnames = true
  tags = { Name = "Production-VPC" }
}

resource "aws_internet_gateway" "prod_igw" {
  vpc_id = aws_vpc.prod_vpc.id
  tags = { Name = "Prod-IGW" }
}

# --- Subnets ---
resource "aws_subnet" "public_web_1" {
  vpc_id = aws_vpc.prod_vpc.id
  cidr_block = "10.0.1.0/24"
  map_public_ip_on_launch = true
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "public_web_2" {
  vpc_id = aws_vpc.prod_vpc.id
  cidr_block = "10.0.2.0/24"
  map_public_ip_on_launch = true
  availability_zone = "us-east-1b"
}

resource "aws_subnet" "private_app_1" {
  vpc_id = aws_vpc.prod_vpc.id
  cidr_block = "10.0.3.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "private_db_1" {
  vpc_id = aws_vpc.prod_vpc.id
  cidr_block = "10.0.4.0/24"
  availability_zone = "us-east-1a"
}

# --- Routing ---
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.prod_vpc.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.prod_igw.id
  }
}

resource "aws_route_table_association" "web_rta_1" {
  subnet_id = aws_subnet.public_web_1.id
  route_table_id = aws_route_table.public_rt.id
}

# --- Security Groups ---
resource "aws_security_group" "alb_sg" {
  vpc_id = aws_vpc.prod_vpc.id
  name = "alb-security-group"

  ingress {
    from_port = 443
    to_port = 443
    protocol = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    from_port = 0
    to_port = 0
    protocol = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "app_sg" {
  vpc_id = aws_vpc.prod_vpc.id
  name = "app-tier-sg"
  
  ingress {
    from_port = 8080
    to_port = 8080
    protocol = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }
}

resource "aws_security_group" "db_sg" {
  vpc_id = aws_vpc.prod_vpc.id
  name = "db-tier-sg"
  
  ingress {
    from_port = 5432
    to_port = 5432
    protocol = "tcp"
    security_groups = [aws_security_group.app_sg.id]
  }
}

# --- Compute & Load Balancing ---
resource "aws_lb" "prod_alb" {
  name = "prod-alb"
  internal = false
  load_balancer_type = "application"
  security_groups = [aws_security_group.alb_sg.id]
  subnets = [aws_subnet.public_web_1.id, aws_subnet.public_web_2.id]
}

resource "aws_lb_target_group" "app_tg" {
  name = "app-target-group"
  port = 8080
  protocol = "HTTP"
  vpc_id = aws_vpc.prod_vpc.id
}

resource "aws_lb_listener" "https_listener" {
  load_balancer_arn = aws_lb.prod_alb.arn
  port = "443"
  protocol = "HTTPS"
  default_action {
    type = "forward"
    target_group_arn = aws_lb_target_group.app_tg.arn
  }
}

resource "aws_instance" "app_server_1" {
  ami = "ami-0abcdef1234567890"
  instance_type = "t3.large"
  subnet_id = aws_subnet.private_app_1.id
  vpc_security_group_ids = [aws_security_group.app_sg.id]
  tags = { Name = "Payment-Service" }
}

# --- Database Tier ---
resource "aws_db_subnet_group" "prod_db_subnet_group" {
  name = "prod-db-subnet-group"
  subnet_ids = [aws_subnet.private_db_1.id]
}

resource "aws_db_instance" "primary_rds" {
  allocated_storage = 100
  engine = "postgres"
  engine_version = "14.7"
  instance_class = "db.m5.xlarge"
  db_name = "proddb"
  username = "admin"
  password = "SuperSecretPassword!"
  vpc_security_group_ids = [aws_security_group.db_sg.id]
  db_subnet_group_name = aws_db_subnet_group.prod_db_subnet_group.name
  skip_final_snapshot = true
  multi_az = false
}

# --- Storage / Cache ---
resource "aws_elasticache_cluster" "session_cache" {
  cluster_id = "prod-session-cache"
  engine = "redis"
  node_type = "cache.t3.medium"
  num_cache_nodes = 1
  parameter_group_name = "default.redis6.x"
  engine_version = "6.2"
  port = 6379
  security_group_ids = [aws_security_group.app_sg.id]
  subnet_group_name = aws_db_subnet_group.prod_db_subnet_group.name
}

resource "aws_s3_bucket" "static_assets" {
  bucket = "prod-static-assets-bucket"
}
