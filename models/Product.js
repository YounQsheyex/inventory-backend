const mongoose = require('mongoose');

const stockHistorySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['purchase', 'sale', 'adjustment', 'return'], required: true },
    quantity: { type: Number, required: true },
    note: { type: String },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Product name is required'], trim: true },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: { type: String, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    costPrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, default: 0, min: 0 },
    minimumStock: { type: Number, default: 10, min: 0 },
    unit: { type: String, default: 'piece', trim: true },
    barcode: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    totalSold: { type: Number, default: 0 },
    stockHistory: [stockHistorySchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

productSchema.virtual('profitMargin').get(function () {
  if (!this.costPrice) return 0;
  return +(((this.sellingPrice - this.costPrice) / this.costPrice) * 100).toFixed(2);
});

productSchema.virtual('stockStatus').get(function () {
  if (this.quantity === 0) return 'out_of_stock';
  if (this.quantity <= this.minimumStock) return 'low_stock';
  return 'in_stock';
});

productSchema.virtual('stockValue').get(function () {
  return +(this.quantity * this.costPrice).toFixed(2);
});

module.exports = mongoose.model('Product', productSchema);
