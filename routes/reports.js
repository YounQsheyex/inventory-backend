const express = require('express');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Expense = require('../models/Expense');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

// GET /api/reports/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [todayStats, monthStats, lastMonthStats, inventoryStats, lowStockProducts, recentSales] = await Promise.all([
      Sale.aggregate([
        { $match: { saleDate: { $gte: todayStart, $lte: todayEnd }, status: 'completed' } },
        { $group: { _id: null, revenue: { $sum: '$total' }, profit: { $sum: '$grossProfit' }, count: { $sum: 1 } } },
      ]),
      Sale.aggregate([
        { $match: { saleDate: { $gte: monthStart }, status: 'completed' } },
        { $group: { _id: null, revenue: { $sum: '$total' }, profit: { $sum: '$grossProfit' }, cost: { $sum: '$totalCost' }, count: { $sum: 1 } } },
      ]),
      Sale.aggregate([
        { $match: { saleDate: { $gte: lastMonthStart, $lte: lastMonthEnd }, status: 'completed' } },
        { $group: { _id: null, revenue: { $sum: '$total' }, profit: { $sum: '$grossProfit' } } },
      ]),
      Product.aggregate([
        { $match: { isActive: true } },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            totalQty: { $sum: '$quantity' },
            stockValue: { $sum: { $multiply: ['$quantity', '$costPrice'] } },
            retailValue: { $sum: { $multiply: ['$quantity', '$sellingPrice'] } },
            lowStock: { $sum: { $cond: [{ $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$minimumStock'] }] }, 1, 0] } },
            outOfStock: { $sum: { $cond: [{ $eq: ['$quantity', 0] }, 1, 0] } },
          },
        },
      ]),
      Product.find({ isActive: true, $expr: { $lte: ['$quantity', '$minimumStock'] } })
        .populate('category', 'name color')
        .select('name sku quantity minimumStock stockStatus')
        .limit(10),
      Sale.find({ status: 'completed' })
        .populate('soldBy', 'name')
        .sort('-saleDate')
        .limit(5)
        .select('invoiceNumber customer total grossProfit saleDate paymentMethod'),
    ]);

    // Last 7 days sales trend
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const salesTrend = await Sale.aggregate([
      { $match: { saleDate: { $gte: sevenDaysAgo }, status: 'completed' } },
      {
        $group: {
          _id: { year: { $year: '$saleDate' }, month: { $month: '$saleDate' }, day: { $dayOfMonth: '$saleDate' } },
          revenue: { $sum: '$total' },
          profit: { $sum: '$grossProfit' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]);

    res.json({
      success: true,
      data: {
        today: todayStats[0] || { revenue: 0, profit: 0, count: 0 },
        thisMonth: monthStats[0] || { revenue: 0, profit: 0, cost: 0, count: 0 },
        lastMonth: lastMonthStats[0] || { revenue: 0, profit: 0 },
        inventory: inventoryStats[0] || { totalProducts: 0, totalQty: 0, stockValue: 0, retailValue: 0, lowStock: 0, outOfStock: 0 },
        lowStockProducts,
        recentSales,
        salesTrend,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/pnl  — Profit & Loss
router.get('/pnl', async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 29));
    start.setHours(0, 0, 0, 0);
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const groupId =
      groupBy === 'month'
        ? { year: { $year: '$saleDate' }, month: { $month: '$saleDate' } }
        : groupBy === 'week'
        ? { year: { $year: '$saleDate' }, week: { $week: '$saleDate' } }
        : { year: { $year: '$saleDate' }, month: { $month: '$saleDate' }, day: { $dayOfMonth: '$saleDate' } };

    const expGroupId =
      groupBy === 'month'
        ? { year: { $year: '$date' }, month: { $month: '$date' } }
        : groupBy === 'week'
        ? { year: { $year: '$date' }, week: { $week: '$date' } }
        : { year: { $year: '$date' }, month: { $month: '$date' }, day: { $dayOfMonth: '$date' } };

    const [salesData, expenseData, summary, expenseSummary, byCategory] = await Promise.all([
      Sale.aggregate([
        { $match: { saleDate: { $gte: start, $lte: end }, status: 'completed' } },
        {
          $group: {
            _id: groupId,
            revenue: { $sum: '$total' },
            cost: { $sum: '$totalCost' },
            grossProfit: { $sum: '$grossProfit' },
            discount: { $sum: '$discount' },
            tax: { $sum: '$tax' },
            salesCount: { $sum: 1 },
          },
        },
        { $addFields: { grossMargin: { $cond: ['$revenue', { $multiply: [{ $divide: ['$grossProfit', '$revenue'] }, 100] }, 0] } } },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } },
      ]),
      Expense.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        { $group: { _id: expGroupId, totalExpenses: { $sum: '$amount' } } },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } },
      ]),
      Sale.aggregate([
        { $match: { saleDate: { $gte: start, $lte: end }, status: 'completed' } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$total' },
            totalCost: { $sum: '$totalCost' },
            totalGrossProfit: { $sum: '$grossProfit' },
            totalDiscount: { $sum: '$discount' },
            totalTax: { $sum: '$tax' },
            totalSales: { $sum: 1 },
            avgOrderValue: { $avg: '$total' },
          },
        },
      ]),
      Expense.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        { $group: { _id: '$category', total: { $sum: '$amount' } } },
        { $sort: { total: -1 } },
      ]),
      Sale.aggregate([
        { $match: { saleDate: { $gte: start, $lte: end }, status: 'completed' } },
        { $unwind: '$items' },
        {
          $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'prod' },
        },
        { $unwind: { path: '$prod', preserveNullAndEmptyArrays: true } },
        {
          $lookup: { from: 'categories', localField: 'prod.category', foreignField: '_id', as: 'cat' },
        },
        { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ['$cat._id', 'uncategorized'] },
            name: { $first: { $ifNull: ['$cat.name', 'Uncategorized'] } },
            color: { $first: { $ifNull: ['$cat.color', '#6366f1'] } },
            revenue: { $sum: '$items.lineTotal' },
            profit: { $sum: { $subtract: ['$items.lineTotal', { $multiply: ['$items.costPrice', '$items.quantity'] }] } },
            quantity: { $sum: '$items.quantity' },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
    ]);

    const totalExpenses = expenseSummary.reduce((a, e) => a + e.total, 0);
    const s = summary[0] || { totalRevenue: 0, totalCost: 0, totalGrossProfit: 0, totalDiscount: 0, totalTax: 0, totalSales: 0, avgOrderValue: 0 };
    const netProfit = s.totalGrossProfit - totalExpenses;

    res.json({
      success: true,
      pnl: { salesData, expenseData },
      summary: { ...s, totalExpenses, netProfit, netMargin: s.totalRevenue ? (netProfit / s.totalRevenue) * 100 : 0 },
      expenseByCategory: expenseSummary,
      byCategory,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/top-products
router.get('/top-products', async (req, res) => {
  try {
    const { startDate, endDate, limit = 10 } = req.query;
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 29));
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const top = await Sale.aggregate([
      { $match: { saleDate: { $gte: start, $lte: end }, status: 'completed' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $first: '$items.productName' },
          sku: { $first: '$items.sku' },
          totalQty: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.lineTotal' },
          totalCost: { $sum: { $multiply: ['$items.costPrice', '$items.quantity'] } },
          totalProfit: { $sum: { $subtract: ['$items.lineTotal', { $multiply: ['$items.costPrice', '$items.quantity'] }] } },
        },
      },
      { $addFields: { margin: { $cond: ['$totalRevenue', { $multiply: [{ $divide: ['$totalProfit', '$totalRevenue'] }, 100] }, 0] } } },
      { $sort: { totalRevenue: -1 } },
      { $limit: +limit },
    ]);

    res.json({ success: true, topProducts: top });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/inventory-value
router.get('/inventory-value', async (req, res) => {
  try {
    const byCategory = await Product.aggregate([
      { $match: { isActive: true } },
      { $lookup: { from: 'categories', localField: 'category', foreignField: '_id', as: 'cat' } },
      { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$cat._id', 'uncategorized'] },
          categoryName: { $first: { $ifNull: ['$cat.name', 'Uncategorized'] } },
          color: { $first: { $ifNull: ['$cat.color', '#6366f1'] } },
          products: { $sum: 1 },
          totalQty: { $sum: '$quantity' },
          costValue: { $sum: { $multiply: ['$quantity', '$costPrice'] } },
          retailValue: { $sum: { $multiply: ['$quantity', '$sellingPrice'] } },
          potentialProfit: { $sum: { $multiply: ['$quantity', { $subtract: ['$sellingPrice', '$costPrice'] }] } },
        },
      },
      { $sort: { costValue: -1 } },
    ]);

    const totals = byCategory.reduce(
      (a, c) => ({
        products: a.products + c.products,
        costValue: a.costValue + c.costValue,
        retailValue: a.retailValue + c.retailValue,
        potentialProfit: a.potentialProfit + c.potentialProfit,
      }),
      { products: 0, costValue: 0, retailValue: 0, potentialProfit: 0 }
    );

    res.json({ success: true, byCategory, totals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
