# 🚀 Deployment Guide

Preflight AI is designed as a distributed microservice architecture. It consists of three main components: the Frontend (Web UI), the Backend API, and the self-hosted AMD Chaos Engine.

## 1. Deploying the Backend (AWS EC2 & DuckDNS)

The backend is built with Python & FastAPI and deployed using Docker on an AWS EC2 instance. We use **DuckDNS** to provide a free domain name and **Certbot** for SSL (HTTPS) to ensure secure communication with the Vercel frontend.

### Step 1: AWS EC2 Provisioning (via AWS CLI)
Alternatively, you can provision the EC2 instance and Security Group entirely via the AWS CLI:

```bash
# 1. Create a Security Group
aws ec2 create-security-group \
    --group-name preflight-sg \
    --description "Security group for Preflight API"

# 2. Add Inbound Rules for SSH, HTTP, HTTPS, and Docker (8000)
aws ec2 authorize-security-group-ingress \
    --group-name preflight-sg \
    --protocol tcp --port 22 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress \
    --group-name preflight-sg \
    --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress \
    --group-name preflight-sg \
    --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress \
    --group-name preflight-sg \
    --protocol tcp --port 8000 --cidr 0.0.0.0/0

# 3. Launch the Ubuntu 24.04 Instance (replace ami, key-name, and subnet)
aws ec2 run-instances \
    --image-id ami-04b70fa74e45c3917 \
    --count 1 \
    --instance-type t3.micro \
    --key-name your-aws-keypair \
    --security-groups preflight-sg \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=Preflight-Backend}]'
```
*(Note: AMI IDs differ by region. Make sure to use an Ubuntu 24.04 AMI for your specific AWS region).*

### Step 2: Setting up DuckDNS
Because AWS EC2 instances often change IP addresses upon reboot (unless you pay for an Elastic IP), we use DuckDNS for dynamic DNS resolution.

1. Go to [DuckDNS.org](https://www.duckdns.org/) and log in.
2. Add a new domain (e.g., `preflight-api.duckdns.org`).
3. Click "Update IP" to map your EC2 instance's **Public IPv4 address** to the domain.
4. *(Critical Note)*: Ensure that the "IPv6" field in DuckDNS is left completely blank, otherwise Vercel edge functions may attempt to resolve the NAT64 IPv6 address and time out with a `502 Bad Gateway`.

### Step 3: EC2 Server Setup (Docker & Nginx)
SSH into your EC2 instance and run the following commands to install dependencies:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker
sudo apt install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu

# Install Nginx and Certbot for SSL
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Step 4: Deploying the Code with Docker
Clone the repository, configure your environment variables, and build the Docker container:

```bash
# Clone the repository
git clone https://github.com/YourOrg/Preflight.git
cd Preflight/backend

# Create your .env file
cat <<EOF > .env
FIREWORKS_API_KEY=your_fireworks_api_key_here
EOF

# Build and run the Docker container
sudo docker build -t preflight-backend .
sudo docker run -d --name preflight-api \
  --restart unless-stopped \
  -p 8000:8000 \
  --env-file .env \
  preflight-backend
```

### Step 5: Nginx & Certbot SSL Configuration
Configure Nginx as a reverse proxy to route traffic from Port 443 (HTTPS) to your Docker container on Port 8000.

Create the Nginx configuration file:
```bash
sudo nano /etc/nginx/sites-available/preflight
```

Paste the following configuration:
```nginx
server {
    server_name preflight-api.duckdns.org;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and obtain an SSL certificate:
```bash
# Enable the Nginx site
sudo ln -s /etc/nginx/sites-available/preflight /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo systemctl restart nginx

# Automatically configure SSL with Certbot
sudo certbot --nginx -d preflight-api.duckdns.org
```
Certbot will automatically modify your Nginx configuration to enforce HTTPS.

### Step 6: GitHub Actions Vercel Proxy (Optional but Recommended)
To prevent local network DNS caching issues, the Vercel frontend is configured to act as a proxy. In your frontend's `vercel.json`:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "http://YOUR_EC2_IPV4_ADDRESS:8000/api/:path*"
    }
  ]
}
```
This bypasses DuckDNS resolution entirely for the frontend, routing traffic securely via Vercel's edge network directly to your EC2 instance.

## 2. Deploying the Chaos Engine (AMD Developer Cloud)

To run the massive Monte Carlo chaos simulations cost-effectively, we self-host the Llama-3-70B model on an AMD MI300X Developer Cloud instance.

1. Provision an **MI300x** Droplet with the **ROCm™ Software** image on the AMD Developer Cloud.
2. SSH into the droplet.
3. Upload and run the provided launch script:
   ```bash
   chmod +x launch_amd_vllm.sh
   ./launch_amd_vllm.sh
   ```
   *(Note: The script uses Docker detached mode (`-d`), so you can safely close your SSH connection once it starts booting).*
4. Add the public IP of this AMD droplet to your backend's `.env` file as `LLM_API_BASE`.

## 3. Deploying the Frontend (Vercel / Netlify)

The React frontend can be hosted statically for free on Vercel or Netlify.

1. Connect your GitHub repository to Vercel.
2. Set the Root Directory to `frontend`.
3. Add the Environment Variable for your deployed backend:
   ```env
   VITE_API_URL=https://your-ec2-backend-domain.com
   ```
4. Click **Deploy**. Vercel will automatically build the static assets using `npm run build` and serve them globally via CDN.
