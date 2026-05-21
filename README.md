# Inventory & Sales Management System — Backend

Node.js + Express + MongoDB REST API

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env and set your MONGODB_URI and JWT_SECRET
```

### 3. Seed sample data (optional)
```bash
npm run seed
# Creates admin user: admin@inventory.com / password123
```

### 4. Start server
```bash
npm run dev      # development (nodemon)
npm start        # production
```

Server runs on **http://localhost:5000**

---

## 📁 Project Structure

```
inventory-backend/
├── server.js               # Entry point
├── .env.example            # Environment variables template
├── config/
│   └── seed.js             # Database seeder
├── middleware/
│   └── auth.js             # JWT auth middleware
├── models/
│   ├── User.js
│   ├── Category.js
│   ├── Supplier.js
│   ├── Product.js
│   ├── Sale.js
│   └── Expense.js
└── routes/
    ├── auth.js
    ├── products.js
    ├── sales.js
    ├── categories.js
    ├── suppliers.js
    ├── expenses.js
    └── reports.js
```

---

## 🔌 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | Login |
| GET  | /api/auth/me | Get current user |
| PUT  | /api/auth/me | Update profile |
| PUT  | /api/auth/change-password | Change password |
| GET  | /api/auth/users | Get all users (admin) |

### Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | /api/products | List products (search, filter, paginate) |
| GET    | /api/products/:id | Get single product |
| POST   | /api/products | Create product (manager+) |
| PUT    | /api/products/:id | Update product (manager+) |
| DELETE | /api/products/:id | Soft delete (admin) |
| POST   | /api/products/:id/adjust-stock | Stock adjustment |

### Sales
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | /api/sales | List sales (filter by date, status) |
| GET    | /api/sales/:id | Get single sale |
| POST   | /api/sales | Create sale (auto deducts stock) |
| PUT    | /api/sales/:id/cancel | Cancel + restore stock |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | /api/reports/dashboard | Dashboard KPIs |
| GET    | /api/reports/pnl | Profit & Loss analysis |
| GET    | /api/reports/top-products | Top selling products |
| GET    | /api/reports/inventory-value | Inventory valuation |

### Expenses, Categories, Suppliers
Standard CRUD on `/api/expenses`, `/api/categories`, `/api/suppliers`

---

## 🌍 Deploying to Render / Railway / Heroku

1. Push code to GitHub
2. Create a new Web Service
3. Set environment variables:
   - `MONGODB_URI` — your MongoDB Atlas connection string
   - `JWT_SECRET` — a long random string
   - `CORS_ORIGIN` — your deployed frontend URL (e.g. `https://myapp.vercel.app`)
   - `NODE_ENV=production`
4. Build command: `npm install`
5. Start command: `npm start`

---

## 👥 User Roles

| Role    | Permissions |
|---------|-------------|
| admin   | Full access |
| manager | CRUD products, sales, expenses, suppliers, categories |
| staff   | View + create sales only |
