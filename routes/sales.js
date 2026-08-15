const express = require("express");
const Sale = require("../models/Sale");
const Product = require("../models/Product");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

const generateInvoice = async () => {
  const count = await Sale.countDocuments();
  const d = new Date();
  return `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}-${String(count + 1).padStart(5, "0")}`;
};

// GET /api/sales
router.get("/", async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      status,
      paymentMethod,
      search,
      page = 1,
      limit = 20,
    } = req.query;
    const query = {};

    if (startDate || endDate) {
      query.saleDate = {};
      if (startDate) query.saleDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.saleDate.$lte = end;
      }
    }
    if (status) query.status = status;
    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (search) query.invoiceNumber = { $regex: search, $options: "i" };

    const total = await Sale.countDocuments(query);
    const sales = await Sale.find(query)
      .populate("soldBy", "name email role")
      .sort("-saleDate")
      .skip((+page - 1) * +limit)
      .limit(+limit);

    const statsAgg = await Sale.aggregate([
      { $match: { ...query, status: "completed" } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$total" },
          totalCost: { $sum: "$totalCost" },
          totalProfit: { $sum: "$grossProfit" },
          count: { $sum: 1 },
        },
      },
    ]);
    const stats = statsAgg[0] || {
      totalRevenue: 0,
      totalCost: 0,
      totalProfit: 0,
      count: 0,
    };

    res.json({
      success: true,
      sales,
      total,
      page: +page,
      pages: Math.ceil(total / +limit),
      stats,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/sales/:id
router.get("/:id", async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).populate(
      "soldBy",
      "name email",
    );
    if (!sale)
      return res
        .status(404)
        .json({ success: false, message: "Sale not found." });
    res.json({ success: true, sale });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sales
router.post("/", async (req, res) => {
  try {
    const {
      customer,
      items,
      discount = 0,
      taxRate = 0,
      paymentMethod,
      paymentStatus,
      notes,
    } = req.body;

    const processedItems = [];
    let subtotal = 0;
    let totalCost = 0;

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) throw new Error(`Product not found: ${item.productId}`);
      if (!product.isActive)
        throw new Error(`Product "${product.name}" is inactive.`);
      if (product.quantity < item.quantity)
        throw new Error(
          `Insufficient stock for "${product.name}". Available: ${product.quantity}`,
        );

      const itemDiscount = item.discount || 0;
      const lineTotal = product.sellingPrice * item.quantity - itemDiscount;
      subtotal += lineTotal;
      totalCost += product.costPrice * item.quantity;

      processedItems.push({
        product: product._id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        costPrice: product.costPrice,
        sellingPrice: product.sellingPrice,
        discount: itemDiscount,
        lineTotal,
      });

      product.quantity -= item.quantity;
      product.totalSold += item.quantity;
      product.stockHistory.push({
        type: "sale",
        quantity: -item.quantity,
        note: "Sale",
        performedBy: req.user._id,
      });
      await product.save();
    }

    const tax = (subtotal - discount) * (taxRate / 100);
    const total = subtotal - discount + tax;
    const grossProfit = total - totalCost;

    const sale = await Sale.create({
      invoiceNumber: await generateInvoice(),
      customer,
      items: processedItems,
      subtotal,
      discount,
      taxRate,
      tax,
      total,
      totalCost,
      grossProfit,
      paymentMethod,
      paymentStatus,
      notes,
      soldBy: req.user._id,
    });

    await sale.populate("soldBy", "name email role");
    res.status(201).json({ success: true, sale });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/sales/:id/cancel
router.put("/:id/cancel", authorize("admin", "manager"), async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale)
      return res
        .status(404)
        .json({ success: false, message: "Sale not found." });
    if (sale.status === "cancelled")
      return res
        .status(400)
        .json({ success: false, message: "Sale already cancelled." });

    for (const item of sale.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { quantity: item.quantity, totalSold: -item.quantity },
        $push: {
          stockHistory: {
            type: "return",
            quantity: item.quantity,
            note: `Cancelled: ${sale.invoiceNumber}`,
            performedBy: req.user._id,
          },
        },
      });
    }

    sale.status = "cancelled";
    await sale.save();
    res.json({
      success: true,
      sale,
      message: "Sale cancelled. Stock restored.",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
