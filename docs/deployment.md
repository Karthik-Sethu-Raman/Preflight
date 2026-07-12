# 🚀 Deployment Guide

Preflight AI is designed as a distributed microservice architecture. It consists of three main components: the Frontend (Web UI), the Backend API, and the self-hosted AMD Chaos Engine.

## 1. Deploying the Backend (AWS EC2)

The backend is built with Python & FastAPI and should be deployed on a Linux VM (like AWS EC2 or DigitalOcean).

1. Clone the repository on your EC2 instance.
2. Install Python 3.10+ and Terraform.
3. Configure the Nginx reverse proxy:
   Copy the `nginx_preflight.conf` file to `/etc/nginx/sites-available/preflight`, create a symlink to `sites-enabled`, and restart Nginx.
4. Set up your `.env` file on the server:
   ```env
   FIREWORKS_API_KEY=your_fireworks_key
   LLM_API_BASE=http://<YOUR_AMD_DROPLET_IP>:8001/v1
   LLM_API_KEY=amd-demo-key
   LLM_MODEL_NAME=meta-llama/Meta-Llama-3-70B-Instruct
   ```
5. Start the backend:
   ```bash
   pip install -r backend/requirements.txt
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
*(For production, wrap the `uvicorn` command in a systemd service or use Docker).*

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
