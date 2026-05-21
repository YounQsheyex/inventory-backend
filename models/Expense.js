const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: ['rent', 'utilities', 'salaries', 'transport', 'marketing', 'maintenance', 'supplies', 'other'],
      default: 'other',
    },
    description: { type: String, trim: true },
    date: { type: Date, default: Date.now },
    paymentMethod: { type: String, enum: ['cash', 'card', 'transfer', 'other'], default: 'cash' },
    receipt: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Expense', expenseSchema);
