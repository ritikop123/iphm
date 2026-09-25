# IPHM NETWORK — High-Performance Verified Hosting Marketplace

A modern, secure web platform for browsing and purchasing verified spoof-enabled hosting providers, dedicated servers, and VPS infrastructure with automated crypto payments and real-time order tracking.

---

## 🚀 Tech Stack

- **Frontend & Bundler:** HTML5, Modern CSS (Glassmorphism & Cyber Theme), Modular JavaScript, [Vite](https://vite.dev)
- **Visuals:** Three.js + Vanta.js (3D Interactive Net Canvas)
- **Database & Auth:** [Supabase](https://supabase.com) (PostgreSQL, Row-Level Security, Auth)
- **Hosting / CDN:** [Cloudflare Pages](https://pages.cloudflare.com)

---

## 📁 Project Structure

```
├── admin.html           # Admin Dashboard & order approval queue
├── app.js               # Core application logic & Supabase client handlers
├── index.html           # Main landing page & provider marketplace
├── orders.html          # Order tracking & invoice cart
├── profile.html         # User profile, account credentials & security
├── public/              # Static assets copied directly to dist/
│   ├── _headers         # Cloudflare Pages security & caching headers
│   └── iphm.png         # Brand logo emblem
├── style.css            # Global modern stylesheet & design system
├── supabase_schema.sql  # Database tables, RLS policies, and triggers
├── vite.config.js       # Vite multi-page build configuration
└── .node-version        # Node.js 20 LTS for Cloudflare Pages build
```

---

## 🛠️ Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

3. **Build for production:**
   ```bash
   npm run build
   ```
   Production assets will be generated in the `dist/` directory.

---

## ☁️ Cloudflare Pages Deployment Guide

When deploying this repository to **Cloudflare Pages**:

1. Log into your **Cloudflare Dashboard** → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Select repository: `ritikop123/iphm` (branch: `main`).
3. Set **Build Settings**:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `/` (leave empty or `/`)
4. **Environment Variables** (Optional):
   - `NODE_VERSION`: `20` (already pre-configured in `.node-version`)
5. Click **Save and Deploy**. Cloudflare Pages will build and deploy your site with global edge caching and SSL!
