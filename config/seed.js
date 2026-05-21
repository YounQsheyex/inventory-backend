require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Category = require('../models/Category');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/inventory_db');
  console.log('Connected. Seeding...');

  await Promise.all([User.deleteMany(), Category.deleteMany(), Supplier.deleteMany(), Product.deleteMany()]);

  const admin = await User.create({ name: 'Admin User', email: 'admin@inventory.com', password: 'password123', role: 'admin' });

  const categories = await Category.insertMany([
    { name: 'Electronics', color: '#6366f1', createdBy: admin._id },
    { name: 'Clothing', color: '#ec4899', createdBy: admin._id },
    { name: 'Food & Beverage', color: '#f59e0b', createdBy: admin._id },
    { name: 'Office Supplies', color: '#10b981', createdBy: admin._id },
    { name: 'Health & Beauty', color: '#f43f5e', createdBy: admin._id },
  ]);

  const suppliers = await Supplier.insertMany([
    { name: 'TechWorld Ltd', email: 'contact@techworld.com', phone: '+234-800-0001', contactPerson: 'James Obi', createdBy: admin._id },
    { name: 'FashionHub Nigeria', email: 'info@fashionhub.ng', phone: '+234-800-0002', contactPerson: 'Amaka Eze', createdBy: admin._id },
    { name: 'FoodMart Distributors', email: 'orders@foodmart.ng', phone: '+234-800-0003', contactPerson: 'Chidi Nwosu', createdBy: admin._id },
  ]);

  await Product.insertMany([
    { name: 'iPhone 14 Pro', sku: 'ELEC-001', category: categories[0]._id, supplier: suppliers[0]._id, costPrice: 550000, sellingPrice: 720000, quantity: 25, minimumStock: 5, unit: 'piece', createdBy: admin._id },
    { name: 'Samsung Galaxy S23', sku: 'ELEC-002', category: categories[0]._id, supplier: suppliers[0]._id, costPrice: 420000, sellingPrice: 560000, quantity: 18, minimumStock: 5, unit: 'piece', createdBy: admin._id },
    { name: 'Wireless Earbuds', sku: 'ELEC-003', category: categories[0]._id, supplier: suppliers[0]._id, costPrice: 15000, sellingPrice: 25000, quantity: 60, minimumStock: 15, unit: 'piece', createdBy: admin._id },
    { name: 'Office Chair', sku: 'OFFICE-001', category: categories[3]._id, costPrice: 35000, sellingPrice: 55000, quantity: 12, minimumStock: 3, unit: 'piece', createdBy: admin._id },
    { name: 'Polo Shirt (M)', sku: 'CLOTH-001', category: categories[1]._id, supplier: suppliers[1]._id, costPrice: 4500, sellingPrice: 8500, quantity: 4, minimumStock: 10, unit: 'piece', createdBy: admin._id },
    { name: 'Mineral Water (24 pack)', sku: 'FOOD-001', category: categories[2]._id, supplier: suppliers[2]._id, costPrice: 1200, sellingPrice: 1800, quantity: 0, minimumStock: 20, unit: 'pack', createdBy: admin._id },
    { name: 'Hand Sanitizer 500ml', sku: 'HEALTH-001', category: categories[4]._id, costPrice: 1500, sellingPrice: 2500, quantity: 85, minimumStock: 20, unit: 'bottle', createdBy: admin._id },
    { name: 'Laptop HP Pavilion', sku: 'ELEC-004', category: categories[0]._id, supplier: suppliers[0]._id, costPrice: 280000, sellingPrice: 380000, quantity: 8, minimumStock: 3, unit: 'piece', createdBy: admin._id },
  ]);

  console.log('✅ Seed complete!');
  console.log('Login: admin@inventory.com / password123');
  process.exit(0);
};

seed().catch((err) => { console.error(err); process.exit(1); });
