"use strict";
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Invoice PDF Generator  —  inventory-backend/routes/invoice.js
 *
 * Fixes applied over v1:
 *   ✅ ₦ symbol now renders correctly (DejaVu font, not Helvetica)
 *   ✅ SVG logos auto-converted to PNG via sharp before embedding
 *   ✅ PNG / JPEG logos supported directly
 *   ✅ Column widths fixed — no more clipping on AMOUNT column
 *   ✅ Footer text properly spaced — no more text running together
 *   ✅ Negative gross profit shows a warning note instead of bad numbers
 *   ✅ Status shown as a coloured pill badge (green=paid, amber=pending, etc.)
 *   ✅ Token accepted via query param (for window.open from browser)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * HOW TO CUSTOMISE FOR ANY BUSINESS
 * ──────────────────────────────────
 * Edit only the COMPANY object below. Nothing else needs changing.
 *
 * LOGO:
 *   1. Drop your logo file into  inventory-backend/assets/
 *      Accepted formats: PNG, JPEG, SVG  (SVG is auto-converted to PNG)
 *   2. Set logoPath below, e.g.:
 *        logoPath: path.join(__dirname, '../assets/logo.png'),
 *      or for SVG:
 *        logoPath: path.join(__dirname, '../assets/logo.svg'),
 *   3. Set logoPath: null  to show text-only header (no logo).
 *
 * FONTS:
 *   The two DejaVuSans .ttf files MUST be in inventory-backend/assets/fonts/
 *   They are included in the ZIP that came with this file.
 *   If you move them, update FONT_DIR below.
 */

const express = require("express");
const PDFKit = require("pdfkit");
const sharp = require("sharp");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const Sale = require("../models/Sale");
const User = require("../models/User");

const router = express.Router();

// ═════════════════════════════════════════════════════════════════════════════
// COMPANY CONFIGURATION  ←  EDIT THIS SECTION FOR EACH DEPLOYMENT
// ═════════════════════════════════════════════════════════════════════════════
const COMPANY = {
  name: "Your Company Name", // ← business name (shown large in header)
  tagline: "Quality Products & Services", // ← strapline (set '' to hide)
  address: "123 Business Street, Lagos, Nigeria", // ← physical address
  email: "info@yourcompany.com", // ← contact email
  phone: "+234-800-000-0000", // ← contact phone
  website: "www.yourcompany.com", // ← website (set '' to hide)

  // Logo — set to full path or null for text-only header
  // Accepted: PNG, JPEG, SVG  (SVG is automatically converted)
  // Example:  path.join(__dirname, '../assets/logo.png')
  logoPath: path.join(__dirname, "../assests/molo.svg"),

  currency: "\u20A6", // ₦  — change to '$', '€', '£' etc. if needed

  // Colours — change to match your brand
  primaryColor: "#8F0714", // header background, table header, total band
  lightBg: "#F5F7FF", // alternating table row tint
};
// ═════════════════════════════════════════════════════════════════════════════

// Font directory — DejaVuSans.ttf and DejaVuSans-Bold.ttf must be here
const FONT_DIR = path.join(__dirname, "../assests/fonts");
const FONT = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n) =>
  `${COMPANY.currency}${Number(n || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const hRule = (doc, y, color = "#CCCCCC", weight = 0.5) =>
  doc
    .save()
    .moveTo(50, y)
    .lineTo(doc.page.width - 50, y)
    .strokeColor(color)
    .lineWidth(weight)
    .stroke()
    .restore();

const statusColors = {
  paid: "#16A34A",
  pending: "#D97706",
  partial: "#2563EB",
  cancelled: "#DC2626",
};

// ─── Auth — accept JWT from header OR query param ─────────────────────────────
async function authenticate(req, res) {
  const token = req.headers.authorization?.split(" ")[1] || req.query.token;

  if (!token) {
    res.status(401).send("Unauthorised");
    return null;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      res.status(401).send("Unauthorised");
      return null;
    }
    return user;
  } catch {
    res.status(401).send("Invalid token");
    return null;
  }
}

// ─── Load logo — supports PNG, JPEG, and SVG ─────────────────────────────────
async function loadLogo(logoPath) {
  if (!logoPath || !fs.existsSync(logoPath)) return null;

  const ext = path.extname(logoPath).toLowerCase();
  if (ext === ".svg") {
    // Convert SVG to PNG so PDFKit can embed it
    return await sharp(fs.readFileSync(logoPath))
      .resize(90, 90, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  }
  // PNG or JPEG — return as buffer directly
  return fs.readFileSync(logoPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ROUTE:  GET /api/invoice/:saleId
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:saleId", async (req, res) => {
  // 1. Authenticate
  const user = await authenticate(req, res);
  if (!user) return;

  // 2. Load sale
  let sale;
  try {
    sale = await Sale.findById(req.params.saleId).populate(
      "soldBy",
      "name role",
    );
  } catch {
    return res
      .status(400)
      .json({ success: false, message: "Invalid sale ID." });
  }

  if (!sale) {
    return res.status(404).json({ success: false, message: "Sale not found." });
  }

  // 3. Load logo (if configured)
  const logoBuffer = await loadLogo(COMPANY.logoPath).catch(() => null);

  // 4. Stream PDF response
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="Invoice-${sale.invoiceNumber}.pdf"`,
  );

  try {
    await generateInvoicePDF(sale, logoBuffer, res);
  } catch (err) {
    console.error("Invoice generation error:", err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ success: false, message: "Failed to generate invoice." });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PDF BUILDER
// ─────────────────────────────────────────────────────────────────────────────
async function generateInvoicePDF(sale, logoBuffer, stream) {
  const doc = new PDFKit({
    size: "A4",
    margin: 0,
    info: {
      Title: `Invoice ${sale.invoiceNumber}`,
      Author: COMPANY.name,
      Subject: "Sales Invoice",
    },
  });

  // Register Unicode-capable fonts (supports ₦ and all Latin characters)
  doc.registerFont("Regular", FONT);
  doc.registerFont("Bold", FONT_BOLD);

  doc.pipe(stream);

  const PW = doc.page.width; // 595
  const PH = doc.page.height; // 842
  const ML = 50; // left margin
  const MR = PW - 50; // right margin
  const CW = MR - ML; // content width = 495

  // ══════════════════════════════════════════════════════
  // SECTION 1 — HEADER BAND
  // ══════════════════════════════════════════════════════
  const HEADER_H = 130;
  doc.save().rect(0, 0, PW, HEADER_H).fill(COMPANY.primaryColor).restore();

  // Logo
  let textStartX = ML;
  if (logoBuffer) {
    doc.image(logoBuffer, ML, 20, { width: 80, height: 80, fit: [80, 80] });
    textStartX = ML + 92;
  }

  // Company name
  doc
    .font("Bold")
    .fontSize(17)
    .fillColor("#FFFFFF")
    .text(COMPANY.name, textStartX, 24, { lineBreak: false });

  // Company details
  doc.font("Regular").fontSize(8.5).fillColor("#C7D2FE");
  let cY = 46;
  if (COMPANY.tagline) {
    doc.text(COMPANY.tagline, textStartX, cY, { lineBreak: false });
    cY += 14;
  }
  doc.text(COMPANY.address, textStartX, cY, { lineBreak: false });
  cY += 13;
  if (COMPANY.email) {
    doc.text(COMPANY.email, textStartX, cY, { lineBreak: false });
    cY += 13;
  }
  if (COMPANY.phone) {
    doc.text(COMPANY.phone, textStartX, cY, { lineBreak: false });
    cY += 13;
  }
  if (COMPANY.website) {
    doc.text(COMPANY.website, textStartX, cY, { lineBreak: false });
  }

  // INVOICE label — right side of header
  doc
    .font("Bold")
    .fontSize(30)
    .fillColor("#FFFFFF")
    .text("INVOICE", ML, 34, { width: CW, align: "right", lineBreak: false });

  // Invoice number under the INVOICE label
  doc
    .font("Regular")
    .fontSize(9)
    .fillColor("#C7D2FE")
    .text(sale.invoiceNumber, ML, 70, {
      width: CW,
      align: "right",
      lineBreak: false,
    });

  // ══════════════════════════════════════════════════════
  // SECTION 2 — BILL TO  +  INVOICE META
  // ══════════════════════════════════════════════════════
  const META_Y = HEADER_H + 22;
  const COL2 = ML + Math.round(CW * 0.52);

  // Bill To block
  doc
    .font("Bold")
    .fontSize(8)
    .fillColor(COMPANY.primaryColor)
    .text("BILL TO", ML, META_Y, { lineBreak: false });

  hRule(doc, META_Y + 12, COMPANY.primaryColor, 1);

  doc
    .font("Bold")
    .fontSize(11)
    .fillColor("#111111")
    .text(sale.customer?.name || "Walk-in Customer", ML, META_Y + 18, {
      lineBreak: false,
    });

  let billY = META_Y + 34;
  doc.font("Regular").fontSize(9).fillColor("#555555");
  if (sale.customer?.phone) {
    doc.text(`Tel: ${sale.customer.phone}`, ML, billY, { lineBreak: false });
    billY += 13;
  }
  if (sale.customer?.email) {
    doc.text(`Email: ${sale.customer.email}`, ML, billY, { lineBreak: false });
    billY += 13;
  }

  // Invoice details — right column
  const dateObj = new Date(sale.saleDate);
  const dateStr = dateObj.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = dateObj.toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const payLabel = sale.paymentMethod || "cash";
  const payStr = payLabel.charAt(0).toUpperCase() + payLabel.slice(1);

  const details = [
    ["Invoice No", sale.invoiceNumber],
    ["Date", dateStr],
    ["Time", timeStr],
    ["Payment", payStr],
    ["Status", ""], // rendered as badge below
    ["Served by", sale.soldBy?.name || "—"],
  ];

  let dY = META_Y;
  details.forEach(([label, value]) => {
    doc
      .font("Bold")
      .fontSize(8)
      .fillColor("#888888")
      .text(label, COL2, dY, { width: 85, lineBreak: false });

    if (label !== "Status") {
      doc
        .font("Regular")
        .fontSize(9)
        .fillColor("#111111")
        .text(value, COL2 + 88, dY, {
          width: MR - COL2 - 88,
          align: "right",
          lineBreak: false,
        });
    }
    dY += 16;
  });

  // Status pill badge
  const statusY = META_Y + 64; // 5th row (0-indexed row 4 × 16)
  const sBg = statusColors[sale.paymentStatus] || "#6B7280";
  const sLabel = (sale.paymentStatus || "paid").toUpperCase();
  const sBadgeX = MR - 58;
  doc
    .save()
    .roundedRect(sBadgeX, statusY - 1, 60, 16, 8)
    .fill(sBg)
    .restore();
  doc
    .font("Bold")
    .fontSize(7.5)
    .fillColor("#FFFFFF")
    .text(sLabel, sBadgeX, statusY + 3, {
      width: 60,
      align: "center",
      lineBreak: false,
    });

  // ══════════════════════════════════════════════════════
  // SECTION 3 — ITEMS TABLE
  // ══════════════════════════════════════════════════════
  const TABLE_Y = Math.max(billY, dY) + 22;
  const ROW_H = 26;

  // Column positions — total must equal CW (495)
  // #(24) + Item(175) + SKU(84) + Qty(38) + UnitPrice(86) + Amount(88) = 495
  const tCols = {
    no: { x: ML, w: 24, align: "center" },
    item: { x: ML + 24, w: 175, align: "left" },
    sku: { x: ML + 199, w: 84, align: "left" },
    qty: { x: ML + 283, w: 38, align: "center" },
    price: { x: ML + 321, w: 86, align: "right" },
    total: { x: ML + 407, w: 88, align: "right" },
  };

  const headers = {
    no: "#",
    item: "ITEM",
    sku: "SKU",
    qty: "QTY",
    price: "UNIT PRICE",
    total: "AMOUNT",
  };

  // Header row
  doc.save().rect(ML, TABLE_Y, CW, ROW_H).fill(COMPANY.primaryColor).restore();
  Object.entries(tCols).forEach(([key, c]) => {
    doc
      .font("Bold")
      .fontSize(8.5)
      .fillColor("#FFFFFF")
      .text(headers[key], c.x + 4, TABLE_Y + 8, {
        width: c.w - 8,
        align: c.align,
        lineBreak: false,
      });
  });

  // Data rows
  let rowY = TABLE_Y + ROW_H;
  sale.items.forEach((item, i) => {
    const bg = i % 2 === 0 ? "#FFFFFF" : COMPANY.lightBg;
    doc.save().rect(ML, rowY, CW, ROW_H).fill(bg).restore();

    const cells = {
      no: String(i + 1),
      item: item.productName || "—",
      sku: item.sku || "—",
      qty: String(item.quantity),
      price: fmt(item.sellingPrice),
      total: fmt(item.lineTotal),
    };

    Object.entries(tCols).forEach(([key, c]) => {
      const isMoney = key === "price" || key === "total";
      doc
        .font(isMoney ? "Bold" : "Regular")
        .fontSize(9)
        .fillColor(isMoney ? "#111111" : "#333333")
        .text(cells[key], c.x + 4, rowY + 8, {
          width: c.w - 8,
          align: c.align,
          lineBreak: false,
        });
    });

    // Row separator
    doc
      .save()
      .moveTo(ML, rowY + ROW_H)
      .lineTo(MR, rowY + ROW_H)
      .strokeColor("#E5E7EB")
      .lineWidth(0.4)
      .stroke()
      .restore();

    rowY += ROW_H;
  });

  // Table outer border
  doc
    .save()
    .rect(ML, TABLE_Y, CW, rowY - TABLE_Y)
    .strokeColor("#D1D5DB")
    .lineWidth(0.5)
    .stroke()
    .restore();

  // ══════════════════════════════════════════════════════
  // SECTION 4 — TOTALS (right-aligned block)
  // ══════════════════════════════════════════════════════
  const TOTALS_X = ML + Math.round(CW * 0.55);
  const TOTALS_W = MR - TOTALS_X; // ≈ 222
  let totY = rowY + 18;

  const totRows = [
    { label: "Subtotal", value: fmt(sale.subtotal) },
    { label: "Discount", value: `- ${fmt(sale.discount)}` },
    { label: `Tax (${sale.taxRate || 0}%)`, value: fmt(sale.tax) },
  ];

  totRows.forEach((r) => {
    doc
      .font("Regular")
      .fontSize(9)
      .fillColor("#666666")
      .text(r.label, TOTALS_X, totY, {
        width: TOTALS_W * 0.48,
        lineBreak: false,
      });
    doc
      .font("Regular")
      .fontSize(9)
      .fillColor("#333333")
      .text(r.value, TOTALS_X, totY, {
        width: TOTALS_W - 2,
        align: "right",
        lineBreak: false,
      });
    totY += 18;
  });

  // TOTAL band
  totY += 5;
  doc
    .save()
    .rect(TOTALS_X - 6, totY - 3, TOTALS_W + 6, 32)
    .fill(COMPANY.primaryColor)
    .restore();
  doc
    .font("Bold")
    .fontSize(12)
    .fillColor("#FFFFFF")
    .text("TOTAL", TOTALS_X + 4, totY + 7, {
      width: TOTALS_W * 0.4,
      lineBreak: false,
    });
  doc
    .font("Bold")
    .fontSize(12)
    .fillColor("#FFFFFF")
    .text(fmt(sale.total), TOTALS_X, totY + 7, {
      width: TOTALS_W - 6,
      align: "right",
      lineBreak: false,
    });
  totY += 40;

  // Gross profit line
  //   if (Number(sale.grossProfit) >= 0) {
  //     doc
  //       .font("Regular")
  //       .fontSize(8)
  //       .fillColor("#16A34A")
  //       .text(
  //         `Gross Profit: ${fmt(sale.grossProfit)}   |   Margin: ${sale.profitMargin || 0}%`,
  //         TOTALS_X,
  //         totY,
  //         { width: TOTALS_W - 2, align: "right", lineBreak: false },
  //       );
  //   } else {
  //     // Warn instead of showing confusing negative profit — likely cost > sell price
  //     doc
  //       .font("Regular")
  //       .fontSize(7.5)
  //       .fillColor("#DC2626")
  //       .text(
  //         "Note: Selling price is below cost price — please review product pricing.",
  //         TOTALS_X,
  //         totY,
  //         { width: TOTALS_W - 2, align: "right", lineBreak: false },
  //       );
  //   }

  // ══════════════════════════════════════════════════════
  // SECTION 5 — NOTES (left side, aligned to table start)
  // ══════════════════════════════════════════════════════
  if (sale.notes) {
    const notesY = rowY + 18;
    doc
      .font("Bold")
      .fontSize(8)
      .fillColor("#888888")
      .text("NOTES", ML, notesY, { lineBreak: false });
    doc
      .save()
      .rect(ML, notesY + 13, 2, 36)
      .fill(COMPANY.primaryColor)
      .restore();
    doc
      .font("Regular")
      .fontSize(9)
      .fillColor("#444444")
      .text(sale.notes, ML + 8, notesY + 13, {
        width: CW * 0.46,
        lineBreak: true,
      });
  }

  // ══════════════════════════════════════════════════════
  // SECTION 6 — FOOTER BAND (pinned to bottom of page)
  // ══════════════════════════════════════════════════════
  const FOOTER_H = 70;
  const FOOTER_Y = PH - FOOTER_H;

  doc
    .save()
    .rect(0, FOOTER_Y, PW, FOOTER_H)
    .fill(COMPANY.primaryColor)
    .restore();

  // Thank you line
  doc
    .font("Bold")
    .fontSize(11)
    .fillColor("#FFFFFF")
    .text("Thank you for your business!", ML, FOOTER_Y + 12, {
      width: CW,
      align: "center",
      lineBreak: false,
    });

  // Contact line
  const contactParts = [COMPANY.email, COMPANY.phone, COMPANY.website].filter(
    Boolean,
  );
  doc
    .font("Regular")
    .fontSize(8.5)
    .fillColor("#C7D2FE")
    .text(contactParts.join("   |   "), ML, FOOTER_Y + 30, {
      width: CW,
      align: "center",
      lineBreak: false,
    });

  // System line
  doc
    .font("Regular")
    .fontSize(7.5)
    .fillColor("#93A5C8")
    .text(
      `Computer-generated invoice  •  ${COMPANY.name}  •  ${sale.invoiceNumber}`,
      ML,
      FOOTER_Y + 48,
      { width: CW, align: "center", lineBreak: false },
    );

  doc.end();

  // Return a promise that resolves when the stream finishes
  return new Promise((resolve, reject) => {
    if (stream.writable) {
      stream.on("finish", resolve);
      stream.on("error", reject);
    } else {
      // res stream doesn't emit 'finish'; resolve immediately
      resolve();
    }
  });
}

module.exports = router;
