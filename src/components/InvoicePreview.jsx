import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import DOMPurify from 'dompurify';
import { numberToWords, printedSubtotal, formatCurrency, INVOICE_TYPES, getCountryConfig, CURRENCY_NAMES, formatExchangeRateLine, getAccountById, getPaperSize, resolveLineDiscount, htmlHasText, splitNumberedTerms, invoiceOptionOn, DEFAULT_DECLARATION, filledOrderDetails, formatShortDate } from '../utils';
import { getPrintSettings, getLabel, formatCurrencyEx, formatDate } from '../utils/printSettings';
import InvoiceGridLayout, { HsnSummaryTable } from './InvoiceGridLayout';

// ====================================================================
// 10th template preset: 'ada_interiors' (Label: "Ada Interiors Custom")
// Selected when options.pdfStyle / printSettings.pdfTemplate === 'ada_interiors'.
// Self-contained - every helper is prefixed `ada` / `ADA_` so it cannot clash
// with anything else in this file.
// ====================================================================
/* ------------------------------------------------------------------ */
/*  Ada Interiors Custom – A4 invoice template                         */
/*  Use inside InvoicePreview.jsx when activePreset === 'ada_interiors' */
/* ------------------------------------------------------------------ */

const ADA_SELLER = {
  gstNo: '03CYQPK1275H1ZB',
  panNo: 'CYQPK1275H',
  name: 'ADA INTERIORS',
  addressLines: ['#22/3, RANCHI COLONY, NR RAILWAY LINE', 'THREEKE ROAD', 'LUDHIANA'],
  phones: ['83600-93750', '99885-04240'],
  bank: {
    name: 'PUNJAB NATIONAL BANK',
    acNo: '1798002100001203',
    ifsc: 'PUNB0179800',
    branch: 'BAREWAL LUDHIANA',
  },
  terms: [
    'Goods once sold will not be taken back.',
    'Interest @ 24% p.a will be charged  if bill is not paid within 30 days.',
    'Subject to Ludhiana Jurisdiction Only.',
  ],
};

// column widths (%) – must add up to exactly 100
const ADA_COLS = [4.5, 25.5, 8.5, 5.5, 9.5, 8.5, 11, 5.5, 8, 5.5, 8];
// vertical grid lines (% from left): after S.No, Description, HSN, Unit, Qty, Rate, Amount, SGST
const ADA_VLINES = [4.5, 30, 38.5, 44, 53.5, 62, 73, 86.5];

const adaNum = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v) || 0);
const adaMoney = (v) => adaNum(v).toFixed(2);
const adaQtyFmt = (v) => adaNum(v).toFixed(3);

/* ---------- amount in words (Indian system) ---------- */
const ADA_ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const ADA_TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

const adaTwoDigits = (n) => (n < 20 ? ADA_ONES[n] : `${ADA_TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ADA_ONES[n % 10] : ''}`);
const adaThreeDigits = (n) =>
  `${n >= 100 ? ADA_ONES[Math.floor(n / 100)] + ' HUNDRED' : ''}${n % 100 ? (n >= 100 ? ' ' : '') + adaTwoDigits(n % 100) : ''}`;

const adaRupeesInWords = (value) => {
  const total = Math.round(adaNum(value) * 100);
  let rupees = Math.floor(total / 100);
  const paise = total % 100;
  if (rupees === 0 && paise === 0) return 'RUPEES ZERO ONLY';
  const parts = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(`${adaThreeDigits(crore)} CRORE`);
  if (lakh) parts.push(`${adaTwoDigits(lakh)} LAKH`);
  if (thousand) parts.push(`${adaTwoDigits(thousand)} THOUSAND`);
  if (rupees) parts.push(adaThreeDigits(rupees));
  let words = `RUPEES ${parts.join(' ')}`.trim();
  if (paise) words += ` AND ${adaTwoDigits(paise)} PAISE`;
  return `${words}  ONLY`;
};

/* ------------------------------------------------------------------ */
/*  data shape expected by this component                              */
/*                                                                     */
/*  {                                                                  */
/*    copyLabel: 'Original For Recipient',                             */
/*    paymentType: 'CREDIT',                                           */
/*    invoiceNo, date, grNo, grDate, transport, vehicleNo, pMark,      */
/*    eRefNo, deliveryAt,                                              */
/*    client: { name, address, gstin, stateCode, stateName },          */
/*    items: [{ name, hsn, unit, qty, rate, amount,                    */
/*              sgstPct, sgstAmt, cgstPct, cgstAmt }],                 */
/*    totals: { taxable, sgst, cgst, roundOff, grandTotal },           */
/*    amountInWords                                                    */
/*  }                                                                  */
/*  Missing totals are calculated from items.                          */
/* ------------------------------------------------------------------ */
function AdaInteriorsTemplate({ data = {} }) {
  const items = Array.isArray(data.items) ? data.items : [];
  const client = data.client || {};

  const totalQty = items.reduce((s, i) => s + adaNum(i.qty), 0);
  const totalAmount = items.reduce((s, i) => s + adaNum(i.amount), 0);

  const t = data.totals || {};
  const taxable = t.taxable !== undefined ? adaNum(t.taxable) : totalAmount;
  const sgst = t.sgst !== undefined ? adaNum(t.sgst) : items.reduce((s, i) => s + adaNum(i.sgstAmt), 0);
  const cgst = t.cgst !== undefined ? adaNum(t.cgst) : items.reduce((s, i) => s + adaNum(i.cgstAmt), 0);
  const raw = taxable + sgst + cgst;
  const grandTotal = t.grandTotal !== undefined ? adaNum(t.grandTotal) : Math.round(raw);
  const roundOff = t.roundOff !== undefined ? adaNum(t.roundOff) : grandTotal - raw;

  const words = data.amountInWords || adaRupeesInWords(grandTotal);

  return (
    <div className="ada-page">
      <style>{ADA_CSS}</style>

      <div className="ada-sheet">
        {/* ---------------- HEADER ---------------- */}
        <div className="ada-header">
          <div className="ada-header-top">
            <div className="ada-hl">
              <div className="ada-idbox"><b>GST NO :</b> {ADA_SELLER.gstNo}</div>
              <div className="ada-idbox"><b>PAN NO :</b> {ADA_SELLER.panNo}</div>
            </div>
            <div className="ada-hc">
              <div className="ada-frame">
                <div className="ada-frame-title">&lt;&lt;TAX INVOICE&gt;&gt;</div>
                <div className="ada-frame-sub">({data.copyLabel || 'Original For Recipient'})</div>
              </div>
            </div>
            <div className="ada-hr">
              <div className="ada-phone"><b>Ph. :</b> {ADA_SELLER.phones[0]}</div>
              <div className="ada-phone">{ADA_SELLER.phones[1]}</div>
            </div>
          </div>

          <div className="ada-brand">{ADA_SELLER.name}</div>
          <div className="ada-address">
            {ADA_SELLER.addressLines.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
          <div className="ada-credit">{data.paymentType || 'CREDIT'}</div>
        </div>

        {/* ---------------- UPPER SPLIT BOX ---------------- */}
        <div className="ada-split">
          <div className="ada-split-left">
            <div className="ada-client">
              <span className="ada-ms">M/s</span>
              <div>
                <div className="ada-client-name">{client.name}</div>
                <div className="ada-client-addr">{client.address}</div>
              </div>
            </div>
            <div className="ada-state-row">
              <div className="ada-state">
                <span className="ada-state-code">{client.stateCode}</span>
                <span className="ada-state-name">{client.stateName}</span>
              </div>
            </div>
            <div className="ada-client-gst"><b>GST NO. :</b> <b>{client.gstin}</b></div>
            <div className="ada-delivery">
              <span className="ada-muted">Delivery At :</span> {data.deliveryAt}
            </div>
          </div>

          <div className="ada-split-right">
            <div className="ada-rrow ada-rrow-2">
              <div>Invoice No. : <span className="ada-mono">{data.invoiceNo}</span></div>
              <div>Dated : <span className="ada-mono">{data.date}</span></div>
            </div>
            <div className="ada-rrow ada-rrow-2">
              <div>GR No. : {data.grNo}</div>
              <div>Dt. : {data.grDate || '/ /'}</div>
            </div>
            <div className="ada-rrow">Transport : {data.transport}</div>
            <div className="ada-rrow">Vehicle No. : {data.vehicleNo}</div>
            <div className="ada-rrow">P. Mark : {data.pMark}</div>
            <div className="ada-rrow ada-rrow-last"><b>Electronic Reference No. :</b> {data.eRefNo}</div>
          </div>
        </div>

        {/* ---------------- ITEMS TABLE ---------------- */}
        <div className="ada-items">
          {/* column lines are drawn once, full height, so they never get cut */}
          <div className="ada-vlines" aria-hidden="true">
            {ADA_VLINES.map((left) => (
              <i key={left} style={{ left: `${left}%` }} />
            ))}
          </div>

          <table className="ada-table">
            <colgroup>
              {ADA_COLS.map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className="ada-left">S.No.</th>
                <th rowSpan={2} className="ada-left">DESCRIPTION OF GOODS</th>
                <th rowSpan={2}>HSN<br />CODE</th>
                <th rowSpan={2}>UNIT</th>
                <th rowSpan={2}>QNTY.</th>
                <th rowSpan={2}>RATE</th>
                <th rowSpan={2}>AMOUNT</th>
                <th colSpan={2} className="ada-tax-h">SGST</th>
                <th colSpan={2} className="ada-tax-h">CGST</th>
              </tr>
              <tr>
                <th className="ada-sub">%</th>
                <th className="ada-sub">Amt.</th>
                <th className="ada-sub">%</th>
                <th className="ada-sub">Amt.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="ada-item-row">
                  <td className="ada-r">{idx + 1}</td>
                  <td>{it.name}</td>
                  <td>{it.hsn}</td>
                  <td>{it.unit}</td>
                  <td className="ada-r">{adaQtyFmt(it.qty)}</td>
                  <td className="ada-r">{adaMoney(it.rate)}</td>
                  <td className="ada-r">{adaMoney(it.amount)}</td>
                  <td className="ada-sm">{adaNum(it.sgstPct).toFixed(1)}%</td>
                  <td className="ada-r">{adaMoney(it.sgstAmt)}</td>
                  <td className="ada-sm">{adaNum(it.cgstPct).toFixed(1)}%</td>
                  <td className="ada-r">{adaMoney(it.cgstAmt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* empty space – pushes the Total row to the bottom of the grid */}
          <div className="ada-spacer" />

          <table className="ada-table ada-total-table">
            <colgroup>
              {ADA_COLS.map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <tbody>
              <tr>
                <td />
                <td className="ada-total-label">Total</td>
                <td />
                <td />
                <td className="ada-r">{adaQtyFmt(totalQty)}</td>
                <td />
                <td className="ada-r">{adaMoney(totalAmount)}</td>
                <td />
                <td />
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        {/* ---------------- BANK + TOTALS ---------------- */}
        <div className="ada-foot">
          <div className="ada-foot-left">
            <div className="ada-reverse">Reverse Charge Not Applicable</div>
            <div className="ada-bank">
              <div>{ADA_SELLER.bank.name}</div>
              <div>A/C NO : {ADA_SELLER.bank.acNo}</div>
              <div>IFSC CODE : {ADA_SELLER.bank.ifsc}</div>
              <div>BRANCH : {ADA_SELLER.bank.branch}</div>
            </div>
            <div className="ada-bank-gap" />
          </div>

          <div className="ada-foot-right">
            <div className="ada-calc ada-calc-top"><span /><span /></div>
            <div className="ada-calc"><span>TAXABLE AMOUNT</span><span className="ada-r">{adaMoney(taxable)}</span></div>
            <div className="ada-calc ada-calc-tax">
              <span>ADD SGST<br />ADD CGST</span>
              <span className="ada-r">{adaMoney(sgst)}<br />{adaMoney(cgst)}</span>
            </div>
            <div className="ada-calc ada-calc-round"><span>ROUND OFF(+/-)</span><span className="ada-r">{adaMoney(roundOff)}</span></div>
            <div className="ada-calc ada-grand"><span className="ada-r">GRAND TOTAL</span><span className="ada-r">{adaMoney(grandTotal)}</span></div>
          </div>
        </div>

        <div className="ada-words"><b>Amount in Words : {words}</b></div>

        {/* ---------------- TERMS + SIGNATURES ---------------- */}
        <div className="ada-bottom">
          <div className="ada-bottom-top">
            <div className="ada-terms">
              <div>Terms &amp; Conditions :</div>
              {ADA_SELLER.terms.map((tm, i) => (
                <div key={i}>{i + 1}. {tm}</div>
              ))}
            </div>
            <div className="ada-for"><b>For {ADA_SELLER.name}</b></div>
          </div>
          <div className="ada-sign-row">
            <b>E. &amp; O. E.</b>
            <b className="ada-receiver">Receiver's Signature</b>
            <b>Authorised Signatory</b>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const ADA_CSS = `
@page { size: A4 portrait; margin: 8mm; }

.ada-page {
  width: 100%;
  min-height: 297mm;
  margin: 0 auto;
  padding: 8mm;
  box-sizing: border-box;
  background: #fff;
  color: #000;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12px;
  line-height: 1.3;
}
.ada-page * { box-sizing: border-box; }
.ada-sheet { border: 1.5px solid #000; }
.ada-r { text-align: right; }
.ada-mono { font-family: 'Courier New', monospace; font-size: 13px; font-weight: 700; }
.ada-muted { color: #000; }

@media print {
  .ada-page { width: auto; min-height: 0; padding: 0; margin: 0; }
  .ada-sheet { break-inside: avoid; }
  .ada-page, .ada-page * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}

/* header */
.ada-header { position: relative; padding: 6px 8px 0; border-bottom: 1.5px solid #000; }
.ada-header-top { display: grid; grid-template-columns: 1fr 1.2fr 1fr; align-items: start; }
.ada-idbox { font-weight: 700; font-size: 13px; line-height: 1.35; }
.ada-idbox b { font-weight: 700; }
.ada-hc { display: flex; justify-content: center; }
.ada-frame { border: 1px solid #000; padding: 2px 14px; text-align: center; }
.ada-frame-title { font-weight: 700; font-size: 15px; }
.ada-frame-sub { font-weight: 700; font-size: 11px; }
.ada-hr { text-align: right; font-weight: 700; font-size: 13px; line-height: 1.5; }
.ada-brand { text-align: center; font-size: 38px; font-weight: 800; font-style: italic; letter-spacing: -0.5px; margin-top: 2px; }
.ada-address { text-align: center; font-weight: 700; font-size: 14px; margin: 14px 0 4px; line-height: 1.35; }
.ada-credit { text-align: right; font-weight: 800; font-size: 14px; padding: 0 0 3px; }

/* upper split */
.ada-split { display: grid; grid-template-columns: 57% 43%; border-bottom: 1.5px solid #000; }
.ada-split-left { border-right: 1.5px solid #000; display: flex; flex-direction: column; }
.ada-client { display: flex; gap: 10px; padding: 4px 8px; min-height: 52px; }
.ada-ms { font-size: 13px; }
.ada-client-name { font-weight: 700; font-size: 14px; }
.ada-client-addr { font-size: 13px; }
.ada-state-row { display: flex; justify-content: flex-end; padding: 0 2px 0 0; margin-top: auto; }
.ada-state { display: flex; border: 1px solid #000; width: 66%; height: 24px; margin-bottom: 4px; }
.ada-state-code { width: 18%; border-right: 1px solid #000; text-align: center; line-height: 22px; font-size: 13px; }
.ada-state-name { flex: 1; text-align: center; line-height: 22px; font-size: 13px; }
.ada-client-gst { border-top: 1px solid #000; padding: 3px 8px; font-size: 13px; }
.ada-delivery { border-top: 1px solid #000; padding: 4px 8px; min-height: 44px; font-size: 13px; }

.ada-split-right { display: flex; flex-direction: column; }
.ada-rrow { padding: 3px 6px; font-size: 13px; min-height: 28px; }
.ada-rrow-2 { display: grid; grid-template-columns: 1.3fr 1fr; border-bottom: 1px solid #000; gap: 6px; }
.ada-rrow-last { margin-top: auto; }

/* items */
.ada-items { position: relative; display: flex; flex-direction: column; min-height: 430px; border-bottom: 1.5px solid #000; }
.ada-vlines { position: absolute; top: 0; bottom: 0; left: 0; right: 0; pointer-events: none; }
.ada-vlines i { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px solid #000; }
.ada-spacer { flex: 1 1 auto; }
.ada-table { position: relative; width: 100%; border-collapse: collapse; table-layout: fixed; }
.ada-table th, .ada-table td { padding: 2px 5px; font-size: 13px; color: #000; vertical-align: top; }
.ada-table thead th { border-bottom: 1.5px solid #000; font-weight: 700; text-align: center; vertical-align: middle; font-size: 13px; }
.ada-table thead th.ada-left { text-align: left; }
.ada-table thead th.ada-tax-h { border-bottom: 0; padding-bottom: 0; }
.ada-table thead th.ada-sub { font-size: 12px; font-weight: 700; padding-top: 0; }
.ada-table thead tr:nth-child(2) th { border-bottom: 1.5px solid #000; }
.ada-item-row td { height: 21px; }
.ada-sm { font-size: 11px !important; text-align: left; }
.ada-total-table td { border-top: 1.5px solid #000; height: 26px; vertical-align: middle; }
.ada-total-label { text-align: right; font-weight: 700; font-size: 14px !important; }

/* bank + totals */
.ada-foot { display: grid; grid-template-columns: 64.3% 35.7%; border-bottom: 1.5px solid #000; }
.ada-foot-left { border-right: 1.5px solid #000; display: flex; flex-direction: column; }
.ada-reverse { font-weight: 700; font-size: 13px; padding: 3px 8px; border-bottom: 1px solid #000; }
.ada-bank { font-family: 'Courier New', monospace; font-size: 12px; font-weight: 700; line-height: 1.25; padding: 4px 6px; flex: 1; min-height: 64px; }
.ada-bank-gap { border-top: 1px solid #000; height: 28px; }

.ada-foot-right { display: flex; flex-direction: column; }
.ada-calc { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #000; font-size: 13px; }
.ada-calc > span { padding: 3px 8px; }
.ada-calc > span:first-child { border-right: 1.5px solid #000; }
.ada-calc-top { height: 26px; }
.ada-calc-tax { min-height: 40px; }
.ada-calc-round { margin-top: auto; }
.ada-grand { border-bottom: 0; background: #e9e9e9; font-weight: 800; }

.ada-words { border-bottom: 1.5px solid #000; padding: 5px 8px; font-size: 13px; }

/* terms + signatures */
.ada-bottom { padding: 4px 8px 4px; }
.ada-bottom-top { display: flex; justify-content: space-between; align-items: flex-start; }
.ada-terms { font-size: 13px; line-height: 1.35; }
.ada-for { font-size: 15px; }
.ada-sign-row { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: end; margin-top: 18px; font-size: 14px; }
.ada-sign-row .ada-receiver { text-align: center; }
.ada-sign-row > :last-child { text-align: right; }
`;

// v1.10.36 — Optional `previewOnly` prop suppresses the internal
// `id="invoice-preview"`. The parent's on-screen preview keeps the id
// (needed by the @media print CSS rules in index.css:1258 for the
// A4 window.print fallback path); the PrintPreviewModal's *second*
// instance renders with previewOnly=true so it doesn't create a
// duplicate id on the page — HTML-invalid + could confuse getElementById
// lookups.
const InvoicePreview = React.forwardRef(({ profile: profileProp, client, details, items, totals, invoiceType = 'tax-invoice', customTerms, customNotes, extraSections = [], options = {}, previewOnly = false, cancelled = false }, ref) => {
  // v1.10.76 - the business profile can still be loading on the first render
  // (a page refresh while editing an invoice), and reading a bank field from
  // null blanked the whole app. Empty until it arrives.
  const profile = profileProp || {};
  // Interstate detection must match InvoiceGenerator.jsx — it honours
  // details.placeOfSupply (POS override) and client.isSEZ (SEZ supplies
  // are always interstate regardless of physical state). Without this
  // the totals block could show IGST while the item table showed
  // CGST+SGST for the same bill (POS override or SEZ client).
  //
  // Cheapest correct signal: totals.igst > 0 means the computation upstream
  // routed the tax as IGST — so trust that, and fall back to the state
  // comparison only if totals aren't populated (e.g. legacy JSON with no
  // igst field).
  const businessState = profile?.state?.trim().toLowerCase();
  const clientState = client?.state?.trim().toLowerCase();
  //
  // v1.10.66 (#61) — the tax engine's own decision now wins. computeInvoiceTotals
  // records `isInterstate` beside the amounts it produced, and every row below
  // has to describe THOSE amounts. The name comparison further down could
  // disagree with the engine — a Delhi client supplied in Punjab, say — and the
  // invoice then printed "IGST ₹0.00" above a total that really held CGST +
  // SGST. The comparison survives only for invoices saved before the flag.
  const isInterstate = typeof totals?.isInterstate === 'boolean'
    ? totals.isInterstate
    : ((typeof totals?.igst === 'number' && totals.igst > 0)
      || !!client?.isSEZ
      || (details?.placeOfSupply && businessState && details.placeOfSupply.toLowerCase() !== businessState)
      || (businessState && clientState && businessState !== clientState));
  const typeConfig = INVOICE_TYPES[invoiceType] || INVOICE_TYPES['tax-invoice'];
  // Seller's country drives tax label (GST / VAT / SST / MwSt etc.) and bank label.
  const sellerCC = getCountryConfig(profile?.country);
  const isIndia = (profile?.country || 'India') === 'India';
  const taxLabel = sellerCC.taxLabel || 'GST';

  // Resolve the payment account once per render. Falls back to the synthesised
  // legacy account (built from flat profile bank fields) when no array exists,
  // so v1.4.3 invoices render byte-identical with no `selectedAccountId`.
  // v1.10.18 — Prefer options.paymentAccountSnapshot when present. That's the
  // frozen-at-save-time copy of the account details, so editing a bank in
  // Settings after the invoice was made no longer rewrites the invoice's
  // displayed bank. Old invoices without the snapshot (pre-v1.10.18) fall
  // through to the live profile lookup — legacy behaviour preserved.
  const account = options.paymentAccountSnapshot || getAccountById(profile, options.selectedAccountId);
  const showAccountLabel = options.showAccountLabel === true;

  // Options with defaults. Each toggle defaults to ON so old invoices keep rendering as
  // before; users opt INTO hiding fields via Customize.
  const opt = (key, fallback = true) => options[key] !== undefined ? options[key] : fallback;
  const showGST = opt('showGST', typeConfig.showGST);
  const showState = opt('showState');
  const showGSTIN = opt('showGSTIN');
  const showPlaceOfSupply = opt('showPlaceOfSupply', showGST);
  const showHSN = opt('showHSN');
  const showDiscount = opt('showDiscount');
  const showBankDetails = opt('showBankDetails');
  const showUPI = opt('showUPI');
  const showLogo = opt('showLogo');
  const showSignature = opt('showSignature');
  const showSignatoryText = opt('showSignatoryText');
  const showTerms = opt('showTerms');
  const showNotes = opt('showNotes');
  // v1.10.70 - requested (#72, @sangwanmail-eng). OFF unless chosen: most
  // invoices are signed, and this line would contradict a signature.
  const showSystemGeneratedNote = opt('showSystemGeneratedNote', false);
  const showAmountWords = opt('showAmountWords');
  const showDueDate = opt('showDueDate');
  const showItemQty = opt('showItemQty');
  const showItemUnit = opt('showItemUnit');
  const showRateColumn = opt('showRateColumn');
  const showSubtotal = opt('showSubtotal');
  // Header / client meta — default ON
  const showBusinessName = opt('showBusinessName');
  const showBusinessAddress = opt('showBusinessAddress');
  const showBusinessPhone = opt('showBusinessPhone');
  const showBusinessEmail = opt('showBusinessEmail');
  const showClientAddress = opt('showClientAddress');
  const showClientPhone = opt('showClientPhone');
  const showClientEmail = opt('showClientEmail');
  const showInvoiceNumber = opt('showInvoiceNumber');
  const showInvoiceDate = opt('showInvoiceDate');
  const customTitle = options.customTitle || typeConfig.title;
  // v1.10.66 (#62) — Rule 46(p) of the CGST Rules: a tax invoice has to state
  // whether tax is payable on reverse charge. The notice under the totals only
  // appears for "Yes", so an ordinary invoice never said "No" at all. Credit
  // notes carry the same flag, which GSTR-1 reports for them.
  const showReverseChargeLine = isIndia && showGST && (invoiceType === 'tax-invoice' || invoiceType === 'credit-note');
  const reverseChargeText = options.reverseCharge ? 'Yes' : 'No';
  const currencySymbol = options.currency || 'INR';

  // v1.10.4 — Single read of print settings per render. Prior code
  // called getPrintSettings() at 6 different points, each hitting
  // localStorage.getItem + JSON.parse. Multiplied by every keystroke
  // in InvoiceGenerator (which rerenders the preview), this was a
  // measurable hot spot. Now: one lookup + downstream aliases keep
  // JSX shape untouched.
  const _ps = getPrintSettings();

  // Print Settings -> Formatting (number grouping, decimals, symbol position,
  // date format) was saved but never used on the invoice. The defaults keep
  // the formatting the invoice always had.
  const fmt = (amount) => {
    if ((_ps.numberFormat && _ps.numberFormat !== 'indian') || Number(_ps.decimalPlaces ?? 2) !== 2 || _ps.currencyPosition === 'after') {
      return formatCurrencyEx(amount, currencySymbol, _ps);
    }
    if (currencySymbol === 'INR') return formatCurrency(amount);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencySymbol, minimumFractionDigits: 2 }).format(amount || 0);
  };
  const fmtDate = (value) => formatDate(value, _ps);

  // Aliases for the different callsites below; all point to the same
  // object so they stay in sync.
  const _ps_dc = _ps;
  // v1.9.3 — same settings alias used by getLabel() calls throughout the JSX
  const _ps_labels = _ps_dc;
  // v1.10.74 - "Total Due" follows the label language; English keeps "Total Due" (preset says "Total").
  const _totalLabel = getLabel(_ps_labels, 'total');
  const totalDueLabel = _totalLabel === 'Total' ? 'Total Due' : _totalLabel;
  const dualCurrencyOn = _ps_dc.dualCurrencyEnabled && currencySymbol === 'INR' && _ps_dc.dualCurrencyCode && Number(_ps_dc.dualCurrencyRate) > 0;
  const fmtDualSecondary = (amount) => {
    if (!dualCurrencyOn || _ps_dc.dualCurrencyPosition !== 'below') return '';
    const secondary = (Number(amount) || 0) / Number(_ps_dc.dualCurrencyRate);
    return '≈ ' + new Intl.NumberFormat('en-US', { style: 'currency', currency: _ps_dc.dualCurrencyCode, minimumFractionDigits: 2 }).format(secondary);
  };

  const amountInWords = (num) => {
    if (currencySymbol === 'INR') return numberToWords(num);
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const convert = (n) => {
      if (n === 0) return 'Zero';
      let result = '';
      if (n >= 1000000) { result += convert(Math.floor(n / 1000000)) + ' Million '; n %= 1000000; }
      if (n >= 1000) { result += convert(Math.floor(n / 1000)) + ' Thousand '; n %= 1000; }
      if (n >= 100) { result += a[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
      if (n >= 20) { result += b[Math.floor(n / 10)] + ' '; if (n % 10) result += a[n % 10] + ' '; }
      else if (n > 0) { result += a[n] + ' '; }
      return result.trim();
    };
    const names = CURRENCY_NAMES[currencySymbol] || { major: currencySymbol, minor: 'Cents' };
    const rounded = Math.round(num * 100) / 100;
    const whole = Math.floor(rounded);
    const cents = Math.round((rounded - whole) * 100);
    let result = convert(whole) + ' ' + names.major;
    if (cents > 0) result += ' and ' + convert(cents) + ' ' + names.minor;
    return result + ' Only';
  };

  const [qrDataUrl, setQrDataUrl] = useState('');

  // Generate UPI QR code. The VPA now comes from the selected payment account
  // (so switching account swaps both bank block + QR), with fallback to the
  // legacy flat profile.upiId for invoices that pre-date multi-account support.
  const upiId = account?.upiId || profile?.upiId || '';
  // The QR asks for what the client actually pays: the total less any TDS
  // they deduct (Net Receivable), not the full total.
  const upiAmount = Number(totals.netReceivable ?? totals.total) || 0;
  useEffect(() => {
    if (!showUPI || !upiId || !(upiAmount > 0) || currencySymbol !== 'INR') {
      setQrDataUrl('');
      return;
    }
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(profile?.businessName || '')}&am=${upiAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Payment for ${details?.invoiceNumber || 'Invoice'}`)}`;
    QRCode.toDataURL(upiUrl, { width: 120, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [showUPI, upiId, profile?.businessName, upiAmount, details?.invoiceNumber, currencySymbol]);

  const accentColors = {
    'tax-invoice': '#1e40af',
    'proforma': '#7c3aed',
    'bill-of-supply': '#0f766e',
    'credit-note': '#be123c',
  };
  // v1.9.14 — When userColorsEnabled is on, pdfAccent MUST feed the
  // header-block background too.
  // v1.10.4 — reuses `_ps` from top of function (was a fresh
  // getPrintSettings() call — one of 6 in this render).
  const accent = options.accentColor
    || (_ps.userColorsEnabled && _ps.pdfAccent)
    || accentColors[invoiceType]
    || accentColors['tax-invoice'];
  // v1.9.1 — template style. Priority: per-invoice options.pdfStyle → app-wide
  // printSettings.pdfTemplate → 'classic' fallback. Also accept the new
  // "corporate" and "minimalist" values that map to existing render paths
  // with slight tweaks (colour tint + spacing) applied via CSS class.
  const pdfStyleRaw = options.pdfStyle || _ps.pdfTemplate || 'classic';
  const pdfStyle = ['corporate', 'minimalist'].includes(pdfStyleRaw)
    ? (pdfStyleRaw === 'corporate' ? 'classic' : 'minimal')
    : pdfStyleRaw;
  const pdfStyleVariant = pdfStyleRaw; // full value for CSS class targeting
  // 10th preset - Ada Interiors Custom (own self-contained layout)
  const isAda = pdfStyleRaw === 'ada_interiors';

  // Check if any item has discount
  const hasAnyDiscount = showDiscount && items.some(item => (item.discount || 0) > 0);

  // v1.10.73 - one per-line calculation for every design, the item table and
  // the HSN/SAC summary, so they can never disagree with each other.
  // v1.10.29 - resolveLineDiscount respects discountType + discountBase, as
  // computeInvoiceTotals does for the totals.
  const lineCalc = (item) => {
    const inclusive = totals.taxInclusive && showGST;
    const discount = resolveLineDiscount(item, inclusive || !showGST);
    const grossAfterDiscount = Math.max(0, (Number(item.quantity) || 0) * (Number(item.rate) || 0) - discount);
    const rate = Number(item.taxPercent) || 0;
    const taxable = inclusive ? grossAfterDiscount / (1 + rate / 100) : grossAfterDiscount;
    const tax = !showGST ? 0 : (inclusive ? grossAfterDiscount - taxable : taxable * rate / 100);
    return { discount, taxable, tax, rate };
  };
  // HSN/SAC-wise tax summary (Tally's table under the items). A line counts
  // if it has an HSN/SAC or carries tax; untaxed reimbursements without a
  // code (fuel, courier) are left out, as Tally does.
  const hsnRows = (() => {
    const map = new Map();
    for (const item of items) {
      const l = lineCalc(item);
      if (!item.hsn && !(l.tax > 0)) continue;
      const k = `${item.hsn || ''}|${l.rate}`;
      const r = map.get(k) || { hsn: item.hsn || '', rate: l.rate, taxable: 0, tax: 0 };
      r.taxable += l.taxable; r.tax += l.tax;
      map.set(k, r);
    }
    return [...map.values()];
  })();
  const pdfStyleForOptions = pdfStyleRaw;
  const showHsnSummary = showGST && invoiceOptionOn(options, 'showHsnSummary', pdfStyleForOptions);
  const showTaxInWords = showGST && invoiceOptionOn(options, 'showTaxInWords', pdfStyleForOptions);
  const showDeclaration = invoiceOptionOn(options, 'showDeclaration', pdfStyleForOptions);
  const showCustomerSeal = invoiceOptionOn(options, 'showCustomerSeal', pdfStyleForOptions);
  const declarationText = options.declarationText ?? DEFAULT_DECLARATION;
  const totalTax = Number(totals.totalTaxAmount) || ((totals.cgst || 0) + (totals.sgst || 0) + (totals.utgst || 0) + (totals.igst || 0) + (totals.cess || 0));
  const orderDetails = filledOrderDetails(details || {});

  // Header renderers per style
  const renderModernHeader = () => (
    <>
      <div style={{ background: accent, padding: '1.5rem 2rem', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          {showLogo && profile?.logo && (
            <img src={profile.logo} alt="Logo" style={{ maxHeight: `${profile.logoHeight || 48}px`, maxWidth: '180px', objectFit: 'contain', marginBottom: '0.5rem', display: 'block', filter: 'brightness(0) invert(1)' }} />
          )}
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, letterSpacing: '0.08em' }}>{customTitle}</h1>
          {invoiceType === 'proforma' && (
            <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', fontStyle: 'italic', margin: '0.25rem 0 0' }}>For estimation purposes only</p>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          {showBusinessName && <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>{profile?.businessName || 'Your Business'}</h2>}
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
            {showBusinessAddress && profile?.address && <p style={{ margin: 0 }}>{profile.address}</p>}
            {showBusinessAddress && (profile?.city || profile?.pin) && <p style={{ margin: 0 }}>{[profile.city, profile.pin].filter(Boolean).join(' - ')}</p>}
            {showState && profile?.state && <p style={{ margin: 0 }}>{profile.state}</p>}
            {showGSTIN && profile?.gstin && <p style={{ margin: 0 }}>{getCountryConfig(profile?.country).taxIdLabel}: {profile.gstin}</p>}
            {showBusinessEmail && profile?.email && <p style={{ margin: 0 }}>{profile.email}</p>}
            {showBusinessPhone && profile?.phone && <p style={{ margin: 0 }}>Ph: {profile.phone}</p>}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 2rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.78rem' }}>
          {showInvoiceNumber && <span><strong style={{ color: '#64748b' }}>No.</strong> {details?.invoiceNumber}</span>}
          {showInvoiceDate && <span><strong style={{ color: '#64748b' }}>Date</strong> {details?.invoiceDate ? fmtDate(details.invoiceDate) : ''}</span>}
          {showDueDate && details?.dueDate && <span><strong style={{ color: '#64748b' }}>Due</strong> {fmtDate(details.dueDate)}</span>}
          {showReverseChargeLine && <span><strong style={{ color: '#64748b' }}>Reverse Charge</strong> {reverseChargeText}</span>}
        </div>
        {invoiceType === 'credit-note' && details?.originalInvoiceRef && (
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Against: <strong style={{ color: '#334155' }}>{details.originalInvoiceRef}</strong></span>
        )}
      </div>
    </>
  );

  const renderMinimalHeader = () => (
    <div style={{ padding: '2rem 2rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          {showLogo && profile?.logo && (
            <img src={profile.logo} alt="Logo" style={{ maxHeight: `${profile.logoHeight || 48}px`, maxWidth: '180px', objectFit: 'contain', marginBottom: '0.5rem', display: 'block' }} />
          )}
          {showBusinessName && <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>{profile?.businessName || 'Your Business'}</h2>}
          <div style={{ fontSize: '0.7rem', color: '#475569', lineHeight: 1.6, marginTop: '0.25rem' }}>
            {showBusinessAddress && profile?.address && <p style={{ margin: 0 }}>{profile.address}</p>}
            {showBusinessAddress && (profile?.city || profile?.pin) && <p style={{ margin: 0 }}>{[profile.city, profile.pin].filter(Boolean).join(' - ')}</p>}
            {showState && profile?.state && <p style={{ margin: 0 }}>{profile.state}</p>}
            {showGSTIN && profile?.gstin && <p style={{ margin: 0 }}>{getCountryConfig(profile?.country).taxIdLabel}: {profile.gstin}</p>}
            {showBusinessEmail && profile?.email && <p style={{ margin: 0 }}>{profile.email}</p>}
            {showBusinessPhone && profile?.phone && <p style={{ margin: 0 }}>Ph: {profile.phone}</p>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: accent, margin: '0 0 0.5rem', letterSpacing: '0.05em' }}>{customTitle}</h1>
          <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.8 }}>
            {showInvoiceNumber && <p style={{ margin: 0 }}>{details?.invoiceNumber}</p>}
            {showInvoiceDate && <p style={{ margin: 0 }}>{details?.invoiceDate ? fmtDate(details.invoiceDate) : ''}</p>}
            {showDueDate && details?.dueDate && <p style={{ margin: 0 }}>Due: {fmtDate(details.dueDate)}</p>}
            {showReverseChargeLine && <p style={{ margin: 0 }}>Reverse Charge: {reverseChargeText}</p>}
            {/* v1.10.74 - Classic and Modern print the credit note's original invoice; Minimal dropped it. */}
            {invoiceType === 'credit-note' && details?.originalInvoiceRef && <p style={{ margin: 0 }}>Against Invoice: {details.originalInvoiceRef}</p>}
          </div>
        </div>
      </div>
      {invoiceType === 'proforma' && (
        <p style={{ fontSize: '0.7rem', color: '#475569', fontStyle: 'italic', margin: '0 0 0.5rem' }}>This is not a tax invoice. For estimation purposes only.</p>
      )}
      <div style={{ borderBottom: `1.5px solid ${accent}`, marginBottom: '0' }} />
    </div>
  );

  const renderClassicHeader = () => (
    <>
      <div style={{ height: '6px', background: `linear-gradient(90deg, ${accent}, ${accent}cc, ${accent}88)` }} />
      <div className="inv-header">
        <div className="inv-header-left">
          {showLogo && profile?.logo && (
            <img src={profile.logo} alt="Logo" style={{ maxHeight: `${profile.logoHeight || 48}px`, maxWidth: '180px', objectFit: 'contain', marginBottom: '0.75rem', display: 'block' }} />
          )}
          <h1 className="inv-title" style={{ color: accent }}>{customTitle}</h1>
          {invoiceType === 'proforma' && (
            <p style={{ fontSize: '0.7rem', color: '#475569', fontStyle: 'italic', marginBottom: '0.75rem' }}>This is not a tax invoice. For estimation purposes only.</p>
          )}
          {invoiceType === 'credit-note' && details?.originalInvoiceRef && (
            <p style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '0.75rem' }}>Against Invoice: <strong style={{ color: '#334155' }}>{details.originalInvoiceRef}</strong></p>
          )}
          <div className="inv-meta">
            {showInvoiceNumber && <div className="inv-meta-row"><span className="inv-meta-label">No.</span><span className="inv-meta-value">{details?.invoiceNumber}</span></div>}
            {showInvoiceDate && <div className="inv-meta-row"><span className="inv-meta-label">Date</span><span className="inv-meta-value">{details?.invoiceDate ? fmtDate(details.invoiceDate) : ''}</span></div>}
            {showDueDate && details?.dueDate && (
              <div className="inv-meta-row"><span className="inv-meta-label">Due Date</span><span className="inv-meta-value">{fmtDate(details.dueDate)}</span></div>
            )}
            {showReverseChargeLine && (
              <div className="inv-meta-row"><span className="inv-meta-label">Reverse Charge</span><span className="inv-meta-value">{reverseChargeText}</span></div>
            )}
          </div>
        </div>
        <div className="inv-header-right">
          {showBusinessName && <h2 className="inv-business-name">{profile?.businessName || 'Your Business'}</h2>}
          <div className="inv-business-details">
            {showBusinessAddress && profile?.address && <p>{profile.address}</p>}
            {showBusinessAddress && (profile?.city || profile?.pin) && <p>{[profile.city, profile.pin].filter(Boolean).join(' - ')}</p>}
            {showState && profile?.state && <p>{profile.state}</p>}
            {showGSTIN && profile?.gstin && <p>{getCountryConfig(profile?.country).taxIdLabel}: <strong>{profile.gstin}</strong></p>}
            {showBusinessEmail && profile?.email && <p>{profile.email}</p>}
            {showBusinessPhone && profile?.phone && <p>Ph: {profile.phone}</p>}
          </div>
        </div>
      </div>
    </>
  );

  // Billing parties section (shared but styled per variant)
  const renderParties = () => {
    const padStyle = pdfStyle === 'modern' ? { padding: '1rem 2rem' } : pdfStyle === 'minimal' ? { padding: '0 2rem 1rem', border: 'none' } : {};
    // v1.10.11 — Ship To block. When the user unchecked "Ship to same as
    // bill-to" in the invoice form, `details.shipToSameAsBilling === false`
    // and shipping fields are populated. Renders as a third column in
    // the parties row. When same-as-billing, we don't render it (bill-to
    // covers both).
    const shipDifferent = details?.shipToSameAsBilling === false &&
      (details?.shippingAddress || details?.shippingCity || details?.shippingState);
    return (
      <div className="inv-parties" style={padStyle}>
        <div className="inv-party">
          <h4 className="inv-section-label">{getLabel(_ps_labels, 'billTo')}</h4>
          <p className="inv-party-name">{client?.name || 'Client Name'}</p>
          <div className="inv-party-details">
            {showClientAddress && client?.address && <p>{client.address}</p>}
            {showClientAddress && (client?.city || client?.pin) && <p>{[client.city, client.pin].filter(Boolean).join(' - ')}</p>}
            {showState && client?.state && <p>{client.state}</p>}
            {showGSTIN && client?.gstin && <p>{getCountryConfig(profile?.country).taxIdLabel}: <strong>{client.gstin}</strong></p>}
            {showClientEmail && client?.email && <p>{client.email}</p>}
            {showClientPhone && client?.phone && <p>Ph: {client.phone}</p>}
          </div>
        </div>
        {shipDifferent && (
          <div className="inv-party">
            <h4 className="inv-section-label">{getLabel(_ps_labels, 'shipTo')}</h4>
            <p className="inv-party-name">{client?.name || 'Client Name'}</p>
            <div className="inv-party-details">
              {details.shippingAddress && <p>{details.shippingAddress}</p>}
              {(details.shippingCity || details.shippingPin) && <p>{[details.shippingCity, details.shippingPin].filter(Boolean).join(' - ')}</p>}
              {details.shippingState && <p>{details.shippingState}</p>}
            </div>
          </div>
        )}
        {showPlaceOfSupply && (
          <div className="inv-party inv-party-right">
            <h4 className="inv-section-label">{getLabel(_ps_labels, 'placeOfSupply')}</h4>
            <p className="inv-party-name">{details?.placeOfSupply || client?.state || '-'}</p>
            {showGST && isIndia && isInterstate && <span className="inv-tax-badge">Interstate (IGST)</span>}
            {showGST && isIndia && !isInterstate && businessState && clientState && <span className="inv-tax-badge inv-tax-badge-green">{totals.isIntraUT ? 'Intra-UT (CGST + UTGST)' : 'Intrastate (CGST + SGST)'}</span>}
            {showGST && !isIndia && <span className="inv-tax-badge inv-tax-badge-green">{taxLabel}</span>}
          </div>
        )}
      </div>
    );
  };

  // Paper-size class + width (v1.8.1 / adapted v1.8.2). Preview container
  // adopts the target paper's width in mm so what-you-see matches
  // what-you-print. For A4/A5 (sheets), the existing multi-column layout
  // renders at scaled type. For thermal 80mm/58mm, we switch to a
  // completely different template — see renderThermalReceipt below.
  //
  // The problem in v1.8.1 was: only the container width changed; the inline
  // margins (`margin: '0 2rem'`) inside the items table + party blocks
  // stayed at A4 sizes. On an 80mm roll, that meant the items were pushed
  // off the right edge. v1.8.2 branches on `kind === 'thermal'` and
  // renders a proper single-column receipt.
  const paperCfg = getPaperSize(options.paperSize, options);
  const isThermal = paperCfg.kind === 'thermal';
  const containerStyle = {
    width: `${paperCfg.widthMm}mm`,
    minHeight: paperCfg.kind === 'sheet' ? `${paperCfg.heightMm}mm` : undefined,
    ...(isThermal ? { fontFamily: '"Courier New", monospace', fontSize: paperCfg.widthMm >= 80 ? '10.5px' : '9px' } : {}),
  };

  // Thermal receipt render — single column, no colour panels, no margins.
  // Used for both 80mm and 58mm; the CSS class (`paper-thermal-58` vs
  // `paper-thermal-80`) further trims (hide QR at 58mm etc.). Inlined here
  // rather than extracted to a helper because it needs access to all the
  // opt() / totals / items closures. Escape-hatch: user can switch back to
  // A4/A5 any time in Customize.
  if (isThermal) {
    // v1.8.4 thermal render — every user-configurable setting from
    // PrintSettings component flows through here. Backward compat: fields
    // fall back to sensible defaults if the bill was created pre-v1.8.4.
    //
    // The app-wide printSettings (localStorage) provides DEFAULTS. Each
    // invoice's own invoiceOptions.thermal* fields OVERRIDE those defaults.
    // Priority: options → printSettings → hardcoded fallback.
    const printSettings = _ps;  // v1.10.4 — reuse top-of-function read
    const eff = {
      thermalFontSize:    options.thermalFontSize    ?? printSettings.fontSize,
      thermalFontFamily:  options.thermalFontFamily  ?? printSettings.fontFamily,
      thermalFontWeight:  options.thermalFontWeight  ?? printSettings.fontWeight,
      thermalAllCaps:     options.thermalAllCaps     ?? printSettings.allCaps,
      thermalLineSpacing: options.thermalLineSpacing ?? printSettings.lineSpacing,
      thermalContrast:    options.thermalContrast    ?? printSettings.contrast,
      thermalHeaderAlign: options.thermalHeaderAlign ?? printSettings.headerAlign,
      thermalHeaderCaps:  options.thermalHeaderCaps  ?? printSettings.headerCaps,
      thermalShowLogo:    options.thermalShowLogo    ?? printSettings.showLogo,
      thermalShowHSN:     options.thermalShowHSN     ?? printSettings.showHSN,
      thermalShowRate:    options.thermalShowRate    ?? printSettings.showRateLine,
      thermalQrSize:      options.thermalQrSize      ?? printSettings.qrSize,
      thermalCutMark:     options.thermalCutMark     ?? printSettings.cutMark,
      thermalFeedLines:   options.thermalFeedLines   ?? printSettings.feedLines,
      thermalFooterMessage: options.thermalFooterMessage ?? printSettings.footerMessage,
      thermalTagline:     options.thermalTagline     ?? (printSettings.showTagline ? printSettings.tagline : ''),
      thermalCompact:     options.thermalCompact     ?? false,
    };

    const invoiceNum = details?.invoiceNumber || '';
    // Receipts keep their short d/m/yyyy unless a date format was chosen.
    const invoiceDate = !details?.invoiceDate ? ''
      : ((_ps.dateFormat || 'dd-mon-yyyy') !== 'dd-mon-yyyy' ? fmtDate(details.invoiceDate) : new Date(details.invoiceDate).toLocaleDateString('en-IN'));
    const sellerCurrency = getCountryConfig(profile?.country).currency;
    const currencySymbol = sellerCurrency === 'INR' ? 'Rs.' : sellerCurrency;
    const showRoundOff = opt('showRoundOff', false);
    // v1.10.33 — Split the single "isNarrow" threshold into two.
    // Prior code used `widthMm < 80` for everything, but thermal80 has
    // widthMm=72 (printable area) and thermal76 has 68 — BOTH tripped
    // the flag and silently:
    //   (a) hid the HSN column even with showHSN=true
    //   (b) rendered at the same tiny font as thermal58
    // Now:
    //   - isVeryNarrow (< 60mm) → thermal58 only, aggressive compaction
    //     (smaller font, hide HSN inline, tighter "Amt" header)
    //   - isNarrow (< 80mm) kept for column-width math where the
    //     thermal80 receipt still needs slightly narrower columns than
    //     thermal112 sheet-style rolls
    const isVeryNarrow = paperCfg.widthMm < 60;
    const isNarrow = paperCfg.widthMm < 80;

    // -- Settings pulled from `eff` (merged options + printSettings) ---------
    const fontSize = eff.thermalFontSize || 'medium';
    const fontFamily = eff.thermalFontFamily || 'mono';
    const fontWeight = eff.thermalFontWeight || 'bold';
    const allCaps = eff.thermalAllCaps === true;
    const lineSpacing = eff.thermalLineSpacing || 'normal';
    const contrast = eff.thermalContrast || 'normal';
    const headerAlign = eff.thermalHeaderAlign || 'center';
    const headerCaps = eff.thermalHeaderCaps !== false;
    const showLogo = eff.thermalShowLogo !== false;
    const showHSN = eff.thermalShowHSN !== false;
    const showRate = eff.thermalShowRate !== false;
    const qrSizePx = eff.thermalQrSize === 'small' ? 60
                   : eff.thermalQrSize === 'large' ? 120 : 90;
    const cutMark = eff.thermalCutMark !== false;
    const feedLines = Number(eff.thermalFeedLines ?? 2);
    const footerMessage = eff.thermalFooterMessage
      || 'Thank you for your business!';
    const tagline = eff.thermalTagline || '';
    const thermalCompact = !!eff.thermalCompact;

    // Base font-size in px based on paper width + user preference.
    // Larger widths get slightly bigger base so 80mm reads bolder than 58mm.
    // v1.10.30 — reported: "fix the font issue and print issue in thermal".
    // Bumped every size ~10-15% so even 58mm at 'small' stays readable
    // after the print driver's raster smoothing. Baseline print quality on
    // low-DPI POS printers is what these numbers are tuned against.
    const fontSizeMap = {
      small:  isVeryNarrow ? 9.5 : 11,
      medium: isVeryNarrow ? 11 : 12.5,
      large:  isVeryNarrow ? 12.5 : 14.5,
      xlarge: isVeryNarrow ? 14 : 16.5,
    };
    const fontSizeBase = (fontSizeMap[fontSize] || fontSizeMap.medium) + 'px';
    // FontFamily: monospace prints crisper on thermal, but some printers
    // handle sans-serif better with newer firmware.
    const fontFamilyCss = fontFamily === 'sans'
      ? '"Arial", "Helvetica", sans-serif'
      : '"Courier New", "Consolas", monospace';
    // FontWeight: baseline 500 (bold), or 800 (ultra) for the darkest print.
    // Normal (400) is included for users on modern printers who want lighter.
    const baseWeight = fontWeight === 'ultra' ? 800
                     : fontWeight === 'normal' ? 500
                     : 700; // bold (default)
    // Bold multiplier for headers/totals — 100 heavier than baseline capped at 900
    const strongWeight = Math.min(900, baseWeight + 200);
    const contrastFilter = contrast === 'ultra' ? 'grayscale(1) contrast(3) brightness(0.85)'
                        : contrast === 'high' ? 'grayscale(1) contrast(2) brightness(0.95)'
                        : 'grayscale(1) contrast(1.4)';
    // Line spacing → line-height multiplier
    const lineHeight = lineSpacing === 'compact' ? 1.2
                     : lineSpacing === 'comfortable' ? 1.6 : 1.4;
    // Section padding pulls from spacing preference
    const secPad = lineSpacing === 'compact' ? '3px 4px'
                 : lineSpacing === 'comfortable' ? '8px 4px' : '5px 4px';
    // Helper: apply ALL CAPS transformation if flag is on
    const cap = (s) => allCaps ? String(s || '').toUpperCase() : String(s || '');
    // Consistent divider styling (dashed lines don't print well; solid does)
    const dashLine = { borderBottom: '1px solid #000', borderTop: 'none' };
    // Root style — EVERY visual attribute set here so nothing accidentally
    // inherits lighter/gray from parent CSS.
    //
    // v1.8.5 darkness fix: text-shadow with a 0.5px horizontal offset in the
    // SAME colour effectively double-strokes each glyph, making thermal
    // print noticeably darker without needing a heavier font. Combined with
    // -webkit-text-stroke this makes even the lightest thermal printer
    // produce crisp readable output. User can turn it OFF via Ultra weight
    // setting if they don't need it.
    // v1.10.30 — stronger double-strike for thermal readability. Prior
    // 0.4px shadow was thin; bumping to 0.6px + adding a diagonal makes
    // glyphs read darker on lightly-burning heads without needing a
    // heavier font weight (which fattens columns and misaligns numbers).
    const textDarkenShadow = fontWeight === 'normal' ? 'none'
                           : '0.6px 0 0 currentColor, 0 0.6px 0 currentColor, 0.4px 0.4px 0 currentColor';
    const rootStyle = {
      ...containerStyle,
      color: '#000',
      background: '#fff',
      fontFamily: fontFamilyCss,
      fontSize: fontSizeBase,
      fontWeight: baseWeight,
      lineHeight,
      letterSpacing: allCaps ? '0.02em' : 0,
      textShadow: textDarkenShadow,
      // Prevent OS-level font smoothing from lightening glyphs at small sizes
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    };

    return (
      <div
        className={`invoice-preview-container ${paperCfg.cssClass} paper-thermal`}
        ref={ref} {...(previewOnly ? {} : { id: 'invoice-preview' })} style={rootStyle}>
        {/* ================= HEADER ================= */}
        <div style={{ padding: '8px 4px 6px', textAlign: headerAlign, ...dashLine, color: '#000' }}>
          {showLogo && profile?.logo && (
            /* v1.10.36 — Reverted the v1.10.33 formula
               `Math.min(45, widthMm * 3.78 * 0.4)` which shrank the
               logo on standard 58/80mm rolls (thermal80 → 45px cap
               vs the historical 45px, thermal58 → 40px). The historical
               45px cap worked on every preset roll. Custom-thermal is
               the only case where the logo can overshoot a narrow roll,
               and the .paper-thermal-custom CSS handles that via
               max-width. */
            <img src={profile.logo} alt="" className="thermal-logo"
              style={{ maxHeight: 45, marginBottom: 4, filter: contrastFilter }} />
          )}
          <div style={{ fontWeight: strongWeight, fontSize: '1.15em', letterSpacing: '0.02em' }}>
            {(headerCaps || allCaps) ? (profile?.businessName || '').toUpperCase() : (profile?.businessName || '')}
          </div>
          {tagline && <div style={{ fontSize: '0.85em', fontWeight: baseWeight, fontStyle: 'italic' }}>{cap(tagline)}</div>}
          {profile?.address && <div style={{ fontSize: '0.9em', fontWeight: baseWeight }}>{cap(profile.address)}</div>}
          {(profile?.city || profile?.state || profile?.pin) && (
            <div style={{ fontSize: '0.9em', fontWeight: baseWeight }}>
              {cap([profile?.city, profile?.state, profile?.pin].filter(Boolean).join(', '))}
            </div>
          )}
          {profile?.gstin && (
            <div style={{ fontSize: '0.9em', fontWeight: strongWeight, marginTop: 2 }}>{cap('GSTIN: ' + profile.gstin)}</div>
          )}
          {profile?.phone && <div style={{ fontSize: '0.9em', fontWeight: baseWeight }}>{cap('Ph: ' + profile.phone)}</div>}
        </div>

        {/* ================= TYPE BANNER ================= */}
        <div style={{ padding: secPad, textAlign: 'center', fontWeight: strongWeight, textTransform: 'uppercase', fontSize: '1.05em', letterSpacing: '0.08em', ...dashLine }}>
          {typeConfig?.label || 'Invoice'}
        </div>

        {/* ================= INVOICE DETAILS ================= */}
        <div style={{ padding: secPad, fontSize: '0.95em', fontWeight: baseWeight, ...dashLine }}>
          <div><strong style={{ fontWeight: strongWeight }}>{cap('Invoice #')}: </strong>{cap(invoiceNum)}</div>
          {showReverseChargeLine && <div><strong style={{ fontWeight: strongWeight }}>{cap('Reverse charge')}: </strong>{cap(reverseChargeText)}</div>}
          <div><strong style={{ fontWeight: strongWeight }}>{cap('Date')}: </strong>{cap(invoiceDate)}</div>
          {client?.name && (
            <div style={{ marginTop: 3 }}>
              <strong style={{ fontWeight: strongWeight }}>{cap('Bill to')}: </strong>{cap(client.name)}
            </div>
          )}
          {client?.gstin && <div>{cap('GSTIN: ' + client.gstin)}</div>}
          {client?.phone && <div>{cap('Ph: ' + client.phone)}</div>}
        </div>

        {/* ================= ITEMS =================
             CSS Grid with a FIXED-WIDTH amount column so every amount lines
             up vertically no matter how long the qty/rate text is. Fixes the
             photo issue where "Rs.225" and "Rs.25" didn't align across rows. */}
        {(() => {
          // Amount column width scales with paper: narrow rolls get less
          // space; wider rolls give amounts more room.
          const amountColMm = isNarrow ? 16 : paperCfg.widthMm < 100 ? 22 : 26;
          const gridCols = `1fr ${amountColMm}mm`;
          return (
            <div style={{ padding: secPad, ...dashLine }}>
              <div style={{
                display: 'grid', gridTemplateColumns: gridCols,
                fontWeight: strongWeight, paddingBottom: 3, marginBottom: 3,
                borderBottom: '1px solid #000', fontSize: '0.95em',
                textTransform: 'uppercase', gap: '4px',
              }}>
                <span>Item</span>
                <span style={{ textAlign: 'right' }}>{isVeryNarrow ? 'Amt' : 'Amount'}</span>
              </div>
              {(items || []).map((item, idx) => {
                const amount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
                const qty = Number(item.quantity) || 0;
                const rate = Number(item.rate) || 0;
                const tax = showGST && item.taxPercent > 0 ? ` +${item.taxPercent}%` : '';
                const hsnBit = showHSN && item.hsn && !isVeryNarrow ? '  |  HSN ' + item.hsn : '';
                return (
                  <div key={idx} style={{ marginBottom: 5, fontSize: '0.95em' }}>
                    <div style={{ fontWeight: strongWeight, wordBreak: 'break-word' }}>
                      {(idx + 1) + '. ' + cap(item.name || item.description || 'Item')}
                    </div>
                    <div style={{
                      display: 'grid', gridTemplateColumns: gridCols, gap: '4px',
                      fontSize: '0.92em', paddingLeft: thermalCompact ? 0 : 8, fontWeight: baseWeight,
                    }}>
                      <span style={{ wordBreak: 'break-word' }}>
                        {cap(showRate
                          ? `${qty}${item.unit ? ' ' + item.unit : ''} × ${currencySymbol}${rate.toFixed(2)}${tax}${hsnBit}`
                          : `${qty}${item.unit ? ' ' + item.unit : ''}${hsnBit}`)}
                      </span>
                      <span style={{ textAlign: 'right', fontWeight: strongWeight }}>{currencySymbol}{amount.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ================= TOTALS =================
             Grid with fixed-width right column so every amount aligns
             vertically (Subtotal / CGST / SGST / Total all rightmost x). */}
        {(() => {
          const totalsColMm = isNarrow ? 18 : paperCfg.widthMm < 100 ? 24 : 30;
          const gridCols = `1fr ${totalsColMm}mm`;
          const rowStyle = { display: 'grid', gridTemplateColumns: gridCols, gap: '4px' };
          const amt = (n) => currencySymbol + (Number(n) || 0).toFixed(2);
          return (
            <div style={{ padding: secPad, fontSize: '1em', fontWeight: baseWeight, ...dashLine }}>
              <div style={rowStyle}>
                <span>{cap('Subtotal')}</span>
                <span style={{ textAlign: 'right' }}>{amt(printedSubtotal(totals))}</span>
              </div>
              {Number(totals?.totalDiscount) > 0 && (
                <div style={rowStyle}>
                  <span>{cap('Discount')}</span>
                  <span style={{ textAlign: 'right' }}>-{amt(totals.totalDiscount)}</span>
                </div>
              )}
              {showGST && Number(totals?.cgst) > 0 && (
                <div style={rowStyle}>
                  <span>{cap('CGST')}</span>
                  <span style={{ textAlign: 'right' }}>{amt(totals.cgst)}</span>
                </div>
              )}
              {showGST && Number(totals?.sgst) > 0 && (
                <div style={rowStyle}>
                  <span>{cap('SGST')}</span>
                  <span style={{ textAlign: 'right' }}>{amt(totals.sgst)}</span>
                </div>
              )}
              {/* Intra-UT supplies (Chandigarh, Ladakh...): without this row
                  the receipt's tax lines did not add up to its total. */}
              {showGST && Number(totals?.utgst) > 0 && (
                <div style={rowStyle}>
                  <span>{cap('UTGST')}</span>
                  <span style={{ textAlign: 'right' }}>{amt(totals.utgst)}</span>
                </div>
              )}
              {showGST && Number(totals?.igst) > 0 && (
                <div style={rowStyle}>
                  <span>{cap('IGST')}</span>
                  <span style={{ textAlign: 'right' }}>{amt(totals.igst)}</span>
                </div>
              )}
              {Number(totals?.cess) > 0 && (
                <div style={rowStyle}>
                  <span>{cap('Cess')}</span>
                  <span style={{ textAlign: 'right' }}>{amt(totals.cess)}</span>
                </div>
              )}
              {/* v1.10.74 - TOTAL already includes TCS and the whole-bill
                  discount; print them so the receipt adds up (same values as the sheet layout). */}
              {Number(totals?.tcsAmount) > 0 && (
                <div style={rowStyle}>
                  <span>{cap('TCS')}</span>
                  <span style={{ textAlign: 'right' }}>{amt(totals.tcsAmount)}</span>
                </div>
              )}
              {Number(totals?.invoiceDiscountAmount) > 0 && (
                <div style={rowStyle}>
                  <span>{cap('Discount on total')}</span>
                  <span style={{ textAlign: 'right' }}>-{amt(totals.invoiceDiscountAmount)}</span>
                </div>
              )}
              {showRoundOff && Number(totals?.roundOff) !== 0 && (
                <div style={rowStyle}>
                  <span>{cap('Round-off')}</span>
                  <span style={{ textAlign: 'right' }}>
                    {Number(totals.roundOff) > 0 ? '+' : ''}{amt(totals.roundOff)}
                  </span>
                </div>
              )}
              <div style={{
                ...rowStyle,
                fontWeight: strongWeight, fontSize: '1.2em', marginTop: 4,
                paddingTop: 4, borderTop: '1px solid #000',
                borderBottom: '2px solid #000', paddingBottom: 4,
              }}>
                <span>{cap('TOTAL')}</span>
                <span style={{ textAlign: 'right' }}>{amt(totals?.total)}</span>
              </div>
              {Number(totals?.tdsAmount) > 0 && (
                <>
                  <div style={{ ...rowStyle, marginTop: 4 }}>
                    <span>{cap('Less: TDS')}</span>
                    <span style={{ textAlign: 'right' }}>-{amt(totals.tdsAmount)}</span>
                  </div>
                  <div style={{ ...rowStyle, fontWeight: strongWeight }}>
                    <span>{cap('Net Receivable')}</span>
                    <span style={{ textAlign: 'right' }}>{amt(totals.netReceivable)}</span>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {showAmountWords && (
          <div style={{ padding: secPad, fontSize: '0.9em', textAlign: 'center', ...dashLine, fontStyle: 'italic', fontWeight: baseWeight }}>
            {cap(amountInWords(totals?.total || 0))}
          </div>
        )}

        {showBankDetails && (account?.bankName || profile?.bankName) && (
          <div style={{ padding: secPad, fontSize: '0.9em', fontWeight: baseWeight, ...dashLine }}>
            <div style={{ fontWeight: strongWeight, textAlign: 'center', marginBottom: 3 }}>{cap('BANK DETAILS')}</div>
            {/* v1.10.37 — Account holder name on thermal too, ONLY if
                the user explicitly filled it (differs from business
                name). Skip when blank so the compact 48/72mm receipt
                doesn't grow a line for a value that would be redundant
                with the business name already printed at the top. */}
            {account?.accountHolderName && account.accountHolderName.trim() && (
              <div>{cap(account.accountHolderName)}</div>
            )}
            <div>{cap(account?.bankName || profile?.bankName)}</div>
            {(account?.accountNumber || profile?.accountNumber) && (
              <div>{cap('A/c: ' + (account?.accountNumber || profile?.accountNumber))}{
                account?.accountType ? ' · ' + cap(({ savings: 'Sav', current: 'Cur', cc: 'CC', od: 'OD', nre: 'NRE', nro: 'NRO' })[account.accountType] || account.accountType) : ''
              }</div>
            )}
            {(account?.ifsc || profile?.ifsc) && <div>{cap('IFSC: ' + (account?.ifsc || profile?.ifsc))}</div>}
          </div>
        )}

        {/* v1.10.13 — reported: "QR for payment should also add on 2 inch
             thermal too because this feature is working in market". Prior
             code gated the UPI QR on `!isNarrow` (widthMm < 80) so 58mm
             rolls silently dropped it. Now: always render when enabled;
             on 58mm the QR is smaller (auto via qrSizePx below) to fit
             the 48mm printable width. */}
        {opt('showUPI') && qrDataUrl && (() => {
          // v1.10.36 — Reverted to the pre-v1.10.33 QR sizing.
          // Reported (Hinglish): "qr small ho gaya hai ... phele jaisa
          // kar dijiye just custom me problem tha". The 50%-of-width
          // formula introduced in v1.10.33 was too aggressive on
          // standard rolls (thermal58/76/80 all shrank), and users had
          // already tuned qrSizePx via the thermalQrSize picker
          // (small=60/medium=90/large=120px). The ONLY roll that needed
          // a defensive cap was the custom sub-100mm case — on a 40mm
          // custom roll the fixed 90px QR spilled off the paper edge.
          // Now: keep the historical behaviour on every preset roll,
          // apply the width-based cap ONLY when paperSize === 'custom'.
          const isCustomThermal = paperCfg.cssClass === 'paper-thermal-custom';
          const size = isCustomThermal
            ? Math.min(qrSizePx, Math.round(paperCfg.widthMm * 3.78 * 0.55))
            : (isNarrow ? Math.min(qrSizePx, 90) : qrSizePx);
          return (
          <div style={{ padding: secPad, textAlign: 'center', ...dashLine }}>
            <img src={qrDataUrl} alt="UPI QR" className="thermal-qr"
              style={{ width: size, height: size, filter: contrastFilter }} />
            <div style={{ fontSize: '0.85em', fontWeight: strongWeight }}>{cap('Scan to pay via UPI')}</div>
          </div>
          );
        })()}

        {showNotes && customNotes && (
          <div style={{ padding: secPad, fontSize: '0.9em', fontWeight: baseWeight, ...dashLine }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(customNotes) }} />
        )}

        {footerMessage && (
          <div style={{ padding: '6px 4px 6px', textAlign: 'center', fontSize: '0.95em', fontWeight: strongWeight }}>
            {cap(`*** ${footerMessage} ***`)}
            {profile?.email && <div style={{ fontWeight: baseWeight, marginTop: 2 }}>{cap(profile.email)}</div>}
          </div>
        )}

        {cutMark && (
          <div style={{ padding: '10px 4px 4px', textAlign: 'center', fontSize: '0.85em', letterSpacing: '0.15em', color: '#000', fontFamily: 'monospace', fontWeight: strongWeight }}>
            {'- - - - -  ✂  CUT HERE  ✂  - - - - -'}
          </div>
        )}

        {/* Feed lines: extra blank lines at bottom so the auto-cutter (or
             manual tear) has clearance below the cut mark. */}
        {feedLines > 0 && (
          <div style={{ height: `${feedLines * 8}px` }} />
        )}
      </div>
    );
  }

  // v1.9.1 — company letterhead + template variant CSS class
  // v1.9.2 — user-configurable colours via CSS custom properties + font scale
  const _ps_final = _ps;  // v1.10.4 — reuse top-of-function read
  const letterheadOn = _ps_final.letterheadEnabled && _ps_final.letterheadImage;
  const hideHeaderBecauseLetterhead = letterheadOn && _ps_final.letterheadHideHeader;

  // v1.9.14 — Inline style typography wiring. Data-attribute CSS from
  // v1.9.13 lost specificity wars against dark-mode overrides and
  // template-* rules, so users saw the font stay put no matter what
  // they picked. Inline styles beat every CSS class regardless of
  // specificity — this is the reliable path.
  //
  // v1.10.9 — decoupled Typography settings from PDF. The Typography
  // section explicitly says "Monospace prints crisper on most thermal
  // printers" — users reasonably expect it to be thermal-only.
  // Meanwhile the dedicated "PDF FONT FAMILY" dropdown (helvetica /
  // times / courier) had NO consumer at all — clicking it did
  // nothing. Now: Typography → thermal only. `pdfFontFamily` →
  // actual PDF font. Font weight + ALL CAPS still bridge to PDF via
  // Typography (they're layout-neutral choices).
  const PDF_FAMILY_MAP = {
    helvetica: 'Helvetica, Arial, "Segoe UI", sans-serif',
    times:     '"Times New Roman", Times, "Liberation Serif", serif',
    courier:   '"Courier New", Courier, "Liberation Mono", monospace',
  };
  const pdfFontFamilyCss = !isThermal
    ? (PDF_FAMILY_MAP[_ps_final.pdfFontFamily] || PDF_FAMILY_MAP.helvetica)
    : undefined;

  // v1.10.10 — pdfFontScale REMOVED from the preview CSS layer.
  // Previously we multiplied `basePct × pdfFontScale` here, but most
  // child elements use `rem`/`px` (not `em`), so a container
  // `font-size: 80%` only cascaded to a handful of nodes and neither
  // the preview nor the real PDF actually shrank. The scale now applies
  // at the PDF-placement layer in buildPDF — shrinking the whole image
  // area on the page — which is both reliable and matches how MS Word
  // "shrink to fit" works. Preview font-size stays base-preset only.
  const PDF_FONT_SIZE_PCT = { small: 87, medium: 100, large: 112, xlarge: 122 };
  const basePct = !isThermal ? (PDF_FONT_SIZE_PCT[_ps_final.fontSize] || 100) : 100;
  const pdfFontSizeCss = !isThermal ? `${basePct}%` : undefined;

  const PDF_FONT_WEIGHT = { normal: 400, bold: 600, ultra: 800 };
  const pdfFontWeightCss = !isThermal ? (PDF_FONT_WEIGHT[_ps_final.fontWeight] || 400) : undefined;
  const pdfCapsOn = !isThermal && _ps_final.allCaps === true;

  // v1.10.37 — Terms & Notes rendering mode. Per-invoice option.termsFormatMode
  // wins over the global printSettings.termsFormatMode. Falls back to
  // 'compact' (historical) so old invoices keep the same PDF pixel-for-pixel.
  //
  // v1.10.38 — Smart default. If no explicit choice was made AND the
  // invoice is services-only (freelancers / consultants / dev shops
  // typically have B2B clients who actually read the terms), default
  // to 'formatted'. Goods invoices stay on 'compact' because their
  // terms are usually retail boilerplate the client never reads.
  // Explicit user choice at either the per-invoice or global level
  // always wins over this heuristic.
  const explicitMode = options.termsFormatMode || _ps_final.termsFormatMode;
  const isServicesInvoice = (options.invoiceMode || 'goods') === 'services';
  const termsFormatMode = explicitMode || (isServicesInvoice ? 'formatted' : 'compact');
  const termsClassMod = termsFormatMode === 'formatted' ? 'inv-terms-formatted' : '';

  const finalContainerStyle = {
    ...containerStyle,
    ...(letterheadOn ? {
      backgroundImage: `url(${_ps_final.letterheadImage})`,
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center top',
    } : {}),
    // v1.9.2 — CSS custom properties for user-controlled colours. Only
    // applied when userColorsEnabled = true (data attribute gates the CSS).
    // Each var falls back to a template default if the user doesn't set it.
    ...(_ps_final.userColorsEnabled ? (() => {
      const accent = _ps_final.pdfAccent || '#1e40af';
      // v1.10.40 — Also compute an RGB channel string so CSS rules can
      // build rgba(var(--pdf-accent-rgb), α) tints. Was using
      // color-mix(in oklab, …) but html2canvas doesn't parse it and
      // fails on Save & Download with "unsupported color function oklab".
      const hex = accent.startsWith('#') ? accent.slice(1) : '';
      const rgb = hex.length === 6
        ? `${parseInt(hex.slice(0,2),16)}, ${parseInt(hex.slice(2,4),16)}, ${parseInt(hex.slice(4,6),16)}`
        : '30, 64, 175';  // fallback to default blue
      return {
        '--pdf-primary-text': _ps_final.pdfPrimaryText || '#0f172a',
        '--pdf-muted-text':   _ps_final.pdfMutedText   || '#334155',
        '--pdf-accent':       accent,
        '--pdf-accent-rgb':   rgb,
        '--pdf-accent-text':  _ps_final.pdfAccentText  || '#ffffff',
        '--pdf-header-bg':    _ps_final.pdfHeaderBg    || '#f8fafc',
        '--pdf-divider':      _ps_final.pdfDividerColor|| '#334155',
      };
    })() : {}),
    // v1.9.14/1.10.9 — inline typography. pdfFontSizeCss already folds
    // in the pdfFontScale multiplier (see the compute above).
    ...(pdfFontFamilyCss ? { fontFamily: pdfFontFamilyCss } : {}),
    ...(pdfFontSizeCss ? { fontSize: pdfFontSizeCss } : {}),
    ...(pdfFontWeightCss ? { fontWeight: pdfFontWeightCss } : {}),
    ...(pdfCapsOn ? { textTransform: 'uppercase' } : {}),
    // v1.10.67 (#66 item 12) — origin for the CANCELLED watermark below.
    position: 'relative',
  };

  // v1.10.73 - Boxed grid / Tally style get everything already worked out
  // above, so their numbers are the same as every other design's.
  const isGrid = pdfStyle === 'boxed' || pdfStyle === 'tally';
  const sanitizedTerms = customTerms ? splitNumberedTerms(DOMPurify.sanitize(customTerms)) : '';
  const sanitizedNotes = customNotes ? splitNumberedTerms(DOMPurify.sanitize(customNotes)) : '';
  const taxedRates = [...new Set(items.map((it) => lineCalc(it)).filter((l) => l.tax > 0).map((l) => l.rate))];
  const gridSig = (() => {
    const sigImg = profile?.signature || (_ps.signatureShow !== false ? _ps.signatureImage : null);
    const stampImg = profile?.stamp || null;
    return {
      show: showSignature && !!(sigImg || stampImg), sigImg, stampImg,
      sigHeight: Number(profile?.signatureHeight) || 60, stampHeight: Number(profile?.stampHeight) || 70,
    };
  })();
  const shipToParty = details?.shipToSameAsBilling === false
    && (details?.shippingAddress || details?.shippingCity || details?.shippingState)
    ? { name: client?.name, address: details.shippingAddress, city: details.shippingCity, pin: details.shippingPin, state: details.shippingState }
    : null;
  const gridNotices = (
    <>
      {options.reverseCharge && isIndia && showGST && (
        <div data-pdf-page-boundary="" style={{ margin: '2px 0 6px', fontSize: '0.92em' }}>
          <strong>Reverse Charge applicable.</strong> GST is payable by the recipient under Section 9(3)/9(4) of the CGST Act.
        </div>
      )}
      {invoiceType === 'composition' && (
        <div data-pdf-page-boundary="" style={{ margin: '2px 0 6px', fontStyle: 'italic', fontSize: '0.92em' }}>
          &quot;Composition taxable person, not eligible to collect tax on supplies.&quot; (Rule 46A, CGST Rules)
        </div>
      )}
      {options.exchangeRate && currencySymbol !== 'INR' && (
        <div data-pdf-page-boundary="" style={{ margin: '2px 0 6px', fontSize: '0.92em' }}>
          {formatExchangeRateLine(currencySymbol, options.exchangeRate, profile?.country === 'India' || !profile?.country ? 'INR' : sellerCC.currency)}
        </div>
      )}
    </>
  );
  const gridCtx = isGrid ? {
    style: pdfStyle, profile, client, details, items, totals, options, invoiceType, accent, fmt, lineCalc, hsnRows,
    invoiceTitle: customTitle, isIndia, isInterstate, taxLabel, sellerCC, account,
    showGST, hasAnyDiscount, showAmountWords, showBankDetails, showSignatoryText, showSystemGeneratedNote,
    showReverseChargeLine, reverseChargeText, qrDataUrl, upiId,
    showHsnSummary, showTaxInWords, showDeclaration, showCustomerSeal, declarationText, totalTax,
    singleRate: taxedRates.length === 1 ? taxedRates[0] : null,
    words: (n) => (currencySymbol === 'INR' ? `INR ${numberToWords(n)}` : amountInWords(n)),
    shortDate: formatShortDate,
    isServices: (options.invoiceMode || 'goods') === 'services',
    docLabel: ({ quotation: 'Quotation', proforma: 'Proforma', 'credit-note': 'Credit Note', 'delivery-challan': 'Challan' })[invoiceType] || 'Invoice',
    placeOfSupply: details?.placeOfSupply || client?.state || '',
    shipTo: shipToParty,
    sig: gridSig,
    notices: gridNotices,
    termsHtml: !_ps.termsSeparatePage && showTerms && htmlHasText(sanitizedTerms) ? sanitizedTerms : '',
    notesHtml: !_ps.termsSeparatePage && showNotes && htmlHasText(sanitizedNotes) ? sanitizedNotes : '',
    termsClassMod,
    t: {
      logo: showLogo, businessName: showBusinessName, businessAddress: showBusinessAddress,
      businessPhone: showBusinessPhone, businessEmail: showBusinessEmail, gstin: showGSTIN, state: showState,
      clientAddress: showClientAddress, clientPhone: showClientPhone, clientEmail: showClientEmail,
      placeOfSupply: showPlaceOfSupply, invoiceNumber: showInvoiceNumber, invoiceDate: showInvoiceDate, dueDate: showDueDate,
      hsn: showHSN, itemQty: showItemQty, itemUnit: showItemUnit, rate: showRateColumn,
    },
  } : null;

  // Ada Interiors Custom - map the app's invoice data onto the template shape.
  // GST is split 50/50 into SGST + CGST (the layout has no IGST column).
  const adaData = isAda ? (() => {
    const rows = items.map((it) => {
      const l = lineCalc(it);
      const half = (l.rate || 0) / 2;
      return {
        name: it.name || it.description || '',
        hsn: it.hsn || '',
        unit: it.unit || '',
        qty: Number(it.quantity) || 0,
        rate: Number(it.rate) || 0,
        amount: l.taxable,
        sgstPct: half, sgstAmt: l.tax / 2,
        cgstPct: half, cgstAmt: l.tax / 2,
      };
    });
    const taxable = rows.reduce((s, r) => s + r.amount, 0);
    const gstSum = (Number(totals?.cgst) || 0) + (Number(totals?.sgst) || 0) + (Number(totals?.utgst) || 0) + (Number(totals?.igst) || 0);
    const halfTax = gstSum > 0 ? gstSum / 2 : rows.reduce((s, r) => s + r.sgstAmt, 0);
    const clientAddr = [client?.address, [client?.city, client?.pin].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
    const gst = client?.gstin || '';
    return {
      copyLabel: options.copyLabel || 'Original For Recipient',
      paymentType: options.paymentType || details?.paymentType || 'CREDIT',
      invoiceNo: details?.invoiceNumber || '',
      date: details?.invoiceDate ? fmtDate(details.invoiceDate) : '',
      grNo: details?.grNo || '',
      grDate: details?.grDate || '',
      transport: details?.transport || '',
      vehicleNo: details?.vehicleNo || '',
      pMark: details?.pMark || '',
      eRefNo: details?.eRefNo || '',
      deliveryAt: [details?.shippingAddress, details?.shippingCity, details?.shippingState].filter(Boolean).join(', '),
      client: {
        name: client?.name || '',
        address: clientAddr,
        gstin: gst,
        stateCode: /^\d{2}/.test(gst) ? gst.slice(0, 2) : '',
        stateName: client?.state || '',
      },
      items: rows,
      totals: {
        taxable,
        sgst: halfTax,
        cgst: halfTax,
        roundOff: Number(totals?.roundOff) || 0,
        grandTotal: Number(totals?.total) || 0,
      },
    };
  })() : null;

  return (
    <div
      className={`invoice-preview-container ${paperCfg.cssClass} template-${pdfStyleVariant}`}
      data-user-colors={_ps_final.userColorsEnabled ? '1' : '0'}
      data-row-density={_ps_final.rowDensity || 'normal'}
      data-header-compact={_ps_final.headerCompact ? '1' : '0'}
      ref={ref} {...(previewOnly ? {} : { id: 'invoice-preview' })} style={finalContainerStyle}>
      {cancelled && (
        <div aria-hidden="true" style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 5,
        }}>
          <span style={{
            transform: 'rotate(-24deg)', whiteSpace: 'nowrap',
            fontSize: '3.6rem', fontWeight: 800, letterSpacing: '0.18em',
            color: 'rgba(220, 38, 38, 0.22)',
            border: '6px solid rgba(220, 38, 38, 0.22)', borderRadius: 14,
            padding: '0.3rem 1.6rem',
          }}>CANCELLED</span>
        </div>
      )}
      {isGrid && <InvoiceGridLayout ctx={gridCtx} />}
      {isAda && <AdaInteriorsTemplate data={adaData} />}
      {isGrid && _ps.termsSeparatePage && (htmlHasText(sanitizedTerms) || htmlHasText(sanitizedNotes)) && (
        <div data-pdf-page="terms" style={{ padding: '2rem', pageBreakBefore: 'always', breakBefore: 'page' }}>
          {showTerms && htmlHasText(sanitizedTerms) && (
            <div className="inv-footer-block">
              <h4 className="inv-section-label">{getLabel(_ps_labels, 'terms')}</h4>
              <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: sanitizedTerms }} />
            </div>
          )}
          {showNotes && htmlHasText(sanitizedNotes) && (
            <div className="inv-footer-block" style={{ marginTop: '2rem' }}>
              <h4 className="inv-section-label">{getLabel(_ps_labels, 'notes')}</h4>
              <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: sanitizedNotes }} />
            </div>
          )}
        </div>
      )}
      {!isGrid && !isAda && (<>
      {!hideHeaderBecauseLetterhead && pdfStyle === 'modern' && renderModernHeader()}
      {!hideHeaderBecauseLetterhead && pdfStyle === 'minimal' && renderMinimalHeader()}
      {!hideHeaderBecauseLetterhead && pdfStyle === 'classic' && renderClassicHeader()}

      {renderParties()}

      {/* v1.10.73 - order / dispatch / reference details, when any are filled */}
      {orderDetails.length > 0 && (
        <div className="inv-parties inv-order-details" data-pdf-page-boundary=""
          style={{ margin: pdfStyle === 'classic' ? '0 0 0.75rem' : '0 2rem 0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.25rem 1rem', fontSize: '0.75rem' }}>
          {orderDetails.map((f) => (
            <div key={f.key} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
              <span style={{ color: '#475569' }}>{f.label}: </span><strong>{f.value}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Items table */}
      <table className="inv-table" style={{ tableLayout: 'auto', ...(pdfStyle === 'modern' ? { margin: '0 2rem', width: 'calc(100% - 4rem)' } : pdfStyle === 'minimal' ? { margin: '0 2rem', width: 'calc(100% - 4rem)', borderTop: 'none' } : {}) }}>
        <thead>
          {showGST ? (
            isIndia && isInterstate ? (
              <>
                <tr>
                  <th className="inv-th" rowSpan="2">#</th>
                  <th className="inv-th" rowSpan="2">Description</th>
                  {showHSN && <th className="inv-th inv-th-center" rowSpan="2">HSN/SAC</th>}
                  {showItemQty && <th className="inv-th inv-th-center" rowSpan="2">Qty</th>}
                  {showRateColumn && <th className="inv-th inv-th-right" rowSpan="2">Rate</th>}
                  {hasAnyDiscount && <th className="inv-th inv-th-right" rowSpan="2">Disc.</th>}
                  <th className="inv-th inv-th-center" colSpan="2" style={{ borderBottom: '1px solid #cbd5e1' }}>IGST</th>
                  <th className="inv-th inv-th-right" rowSpan="2">Amount</th>
                </tr>
                <tr>
                  <th className="inv-th inv-th-center">%</th>
                  <th className="inv-th inv-th-right">Amt</th>
                </tr>
              </>
            ) : isIndia ? (
              <>
                <tr>
                  <th className="inv-th" rowSpan="2">#</th>
                  <th className="inv-th" rowSpan="2">Description</th>
                  {showHSN && <th className="inv-th inv-th-center" rowSpan="2">HSN/SAC</th>}
                  {showItemQty && <th className="inv-th inv-th-center" rowSpan="2">Qty</th>}
                  {showRateColumn && <th className="inv-th inv-th-right" rowSpan="2">Rate</th>}
                  {hasAnyDiscount && <th className="inv-th inv-th-right" rowSpan="2">Disc.</th>}
                  <th className="inv-th inv-th-center" colSpan="2" style={{ borderBottom: '1px solid #cbd5e1' }}>CGST</th>
                  <th className="inv-th inv-th-center" colSpan="2" style={{ borderBottom: '1px solid #cbd5e1' }}>{totals.isIntraUT ? 'UTGST' : 'SGST'}</th>
                  <th className="inv-th inv-th-right" rowSpan="2">Amount</th>
                </tr>
                <tr>
                  <th className="inv-th inv-th-center">%</th>
                  <th className="inv-th inv-th-right">Amt</th>
                  <th className="inv-th inv-th-center">%</th>
                  <th className="inv-th inv-th-right">Amt</th>
                </tr>
              </>
            ) : (
              // Foreign: single tax column (VAT/SST/etc.) — no CGST/SGST/IGST split
              <>
                <tr>
                  <th className="inv-th" rowSpan="2">#</th>
                  <th className="inv-th" rowSpan="2">Description</th>
                  {showHSN && <th className="inv-th inv-th-center" rowSpan="2">HSN/SAC</th>}
                  {showItemQty && <th className="inv-th inv-th-center" rowSpan="2">Qty</th>}
                  {showRateColumn && <th className="inv-th inv-th-right" rowSpan="2">Rate</th>}
                  {hasAnyDiscount && <th className="inv-th inv-th-right" rowSpan="2">Disc.</th>}
                  <th className="inv-th inv-th-center" colSpan="2" style={{ borderBottom: '1px solid #cbd5e1' }}>{taxLabel}</th>
                  <th className="inv-th inv-th-right" rowSpan="2">Amount</th>
                </tr>
                <tr>
                  <th className="inv-th inv-th-center">%</th>
                  <th className="inv-th inv-th-right">Amt</th>
                </tr>
              </>
            )
          ) : (
            <tr>
              <th className="inv-th">#</th>
              <th className="inv-th">Description</th>
              {showHSN && <th className="inv-th inv-th-center">HSN/SAC</th>}
              {showItemQty && <th className="inv-th inv-th-center">Qty</th>}
              {showRateColumn && <th className="inv-th inv-th-right">Rate</th>}
              {hasAnyDiscount && <th className="inv-th inv-th-right">Disc.</th>}
              <th className="inv-th inv-th-right">Amount</th>
            </tr>
          )}
        </thead>
        <tbody>
          {items.map((item, index) => {
            // Shared with the grid designs and the HSN summary (lineCalc).
            const { discount, taxable: afterDiscount, tax: taxAmount, rate: taxRate } = lineCalc(item);
            const halfRate = taxRate / 2;
            const halfTax = taxAmount / 2;
            return (
              <tr key={item.id} className={index % 2 === 0 ? 'inv-tr-even' : ''}>
                <td className="inv-td inv-td-muted">{index + 1}</td>
                <td className="inv-td inv-td-name">
                  {item.name || '-'}
                  {/* v1.10.22 — optional per-line description shown under the
                      name in a smaller, muted font. Renders only when set so
                      pre-existing invoices without a description look
                      identical. */}
                  {item.description && (
                    <div style={{ fontSize: '0.78em', color: '#475569', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                      {item.description}
                    </div>
                  )}
                </td>
                {showHSN && <td className="inv-td inv-td-center inv-td-muted">{item.hsn || '-'}</td>}
                {showItemQty && <td className="inv-td inv-td-center">{item.quantity}{showItemUnit && item.unit ? ` ${item.unit}` : ''}</td>}
                {showRateColumn && <td className="inv-td inv-td-right">{fmt(item.rate)}</td>}
                {hasAnyDiscount && <td className="inv-td inv-td-right">{discount > 0 ? fmt(discount) : '-'}</td>}
                {showGST && (
                  isIndia && isInterstate ? (
                    <>
                      <td className="inv-td inv-td-center">{taxRate}%</td>
                      <td className="inv-td inv-td-right">{fmt(taxAmount)}</td>
                    </>
                  ) : isIndia ? (
                    <>
                      <td className="inv-td inv-td-center">{halfRate}%</td>
                      <td className="inv-td inv-td-right">{fmt(halfTax)}</td>
                      <td className="inv-td inv-td-center">{halfRate}%</td>
                      <td className="inv-td inv-td-right">{fmt(halfTax)}</td>
                    </>
                  ) : (
                    <>
                      <td className="inv-td inv-td-center">{taxRate}%</td>
                      <td className="inv-td inv-td-right">{fmt(taxAmount)}</td>
                    </>
                  )
                )}
                <td className="inv-td inv-td-right inv-td-amount">{fmt(afterDiscount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals section */}
      <div className="inv-totals-section" style={pdfStyle !== 'classic' ? { padding: '1rem 2rem' } : {}}>
        <div className="inv-words">
          {showAmountWords && (
            <>
              <h4 className="inv-section-label">{getLabel(_ps_labels, 'amountInWords')}</h4>
              <p className="inv-words-text">{amountInWords(totals.total)}</p>
              {/* v1.9.1 — dual currency below the words line (foreign clients) */}
              {dualCurrencyOn && (
                <p style={{ fontSize: '0.85em', color: '#555', fontStyle: 'italic', margin: '0.15rem 0 0' }}>
                  Total: {fmt(totals.total)} · {fmtDualSecondary(totals.total)}
                </p>
              )}
            </>
          )}
          {/* UPI QR Code */}
          {qrDataUrl && (
            <div style={{ marginTop: '1.25rem' }}>
              <h4 className="inv-section-label">SCAN TO PAY (UPI)</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <img src={qrDataUrl} alt="UPI QR" style={{ width: '90px', height: '90px', borderRadius: '6px', border: '1px solid #e2e8f0' }} />
                <div style={{ fontSize: '0.7rem', color: '#475569', lineHeight: 1.5 }}>
                  <p style={{ margin: 0, color: '#475569' }}>UPI ID:</p>
                  <p style={{ margin: 0, color: '#334155', fontWeight: 600, fontSize: '0.75rem' }}>{upiId}</p>
                  <p style={{ margin: '0.25rem 0 0', color: '#475569' }}>{fmt(totals.total)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="inv-totals">
          {showSubtotal && (
            <div className="inv-total-row">
              {/* v1.10.74 - Subtotal / Total Due / Authorized Signatory now follow the label language. */}
              <span>{getLabel(_ps_labels, 'subtotal')}</span>
              <span>{fmt(printedSubtotal(totals))}</span>
            </div>
          )}
          {totals.totalDiscount > 0 && (
            <div className="inv-total-row" style={{ color: '#dc2626' }}>
              <span>Discount</span>
              <span>- {fmt(totals.totalDiscount)}</span>
            </div>
          )}
          {showGST && (
            isIndia && isInterstate ? (
              <div className="inv-total-row">
                <span>IGST</span>
                <span>{fmt(totals.igst)}</span>
              </div>
            ) : isIndia ? (
              <>
                <div className="inv-total-row">
                  <span>CGST</span>
                  <span>{fmt(totals.cgst)}</span>
                </div>
                {/* Intra-UT supplies charge UTGST, not SGST: this row read
                    "SGST 0.00" and the UTGST was missing from the printout. */}
                <div className="inv-total-row">
                  <span>{totals.isIntraUT ? 'UTGST' : 'SGST'}</span>
                  <span>{fmt((totals.sgst || 0) + (totals.utgst || 0))}</span>
                </div>
              </>
            ) : (
              <div className="inv-total-row">
                <span>{taxLabel}</span>
                <span>{fmt((totals.cgst || 0) + (totals.sgst || 0) + (totals.igst || 0))}</span>
              </div>
            )
          )}
          {totals.cess > 0 && (
            <div className="inv-total-row">
              <span>GST Cess</span>
              <span>{fmt(totals.cess)}</span>
            </div>
          )}
          {totals.tcsAmount > 0 && (
            <div className="inv-total-row">
              <span>TCS{options.tcsSection ? ` (${options.tcsSection} @ ${options.tcsRate}%)` : ''}</span>
              <span>{fmt(totals.tcsAmount)}</span>
            </div>
          )}
          {/* v1.10.22 — invoice-level (post-tax) discount, if any. */}
          {totals.invoiceDiscountAmount > 0 && (
            <div className="inv-total-row" style={{ color: '#dc2626' }}>
              <span>
                Discount on total
                {totals.invoiceDiscountType === 'percent' && totals.invoiceDiscountValue > 0
                  ? ` (${totals.invoiceDiscountValue}%)`
                  : ''}
              </span>
              <span>−{fmt(totals.invoiceDiscountAmount)}</span>
            </div>
          )}
          {totals.roundOff !== undefined && totals.roundOff !== 0 && (
            <div className="inv-total-row" style={{ color: '#64748b', fontStyle: 'italic' }}>
              <span>Round-off</span>
              <span>{totals.roundOff > 0 ? '+' : ''}{fmt(totals.roundOff)}</span>
            </div>
          )}
          {pdfStyle === 'modern' ? (
            <div className="inv-total-row inv-total-final inv-total-modern" style={{ background: accent, color: '#fff', borderRadius: '6px', padding: '0.6rem 0.75rem', marginTop: '0.25rem' }}>
              <span style={{ color: '#fff' }}>{invoiceType === 'credit-note' ? 'Credit Amount' : totalDueLabel}</span>
              <span style={{ color: '#fff' }}>{fmt(totals.total)}</span>
            </div>
          ) : (
            <div className="inv-total-row inv-total-final">
              <span>{invoiceType === 'credit-note' ? 'Credit Amount' : totalDueLabel}</span>
              <span style={{ color: accent }}>{fmt(totals.total)}</span>
            </div>
          )}
          {totals.tdsAmount > 0 && (
            <>
              <div className="inv-total-row" style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem', borderTop: '1px dashed #e2e8f0', paddingTop: '0.4rem' }}>
                <span>Less: TDS{options.tdsSection ? ` (${options.tdsSection} @ ${options.tdsRate}%)` : ''}</span>
                <span>− {fmt(totals.tdsAmount)}</span>
              </div>
              <div className="inv-total-row" style={{ fontWeight: 600, color: '#0f766e', fontSize: '0.78rem' }}>
                <span>Net Receivable</span>
                <span>{fmt(totals.netReceivable)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {(showHsnSummary && hsnRows.length > 0) || (showTaxInWords && totalTax > 0) ? (
        <div style={{ margin: pdfStyle === 'classic' ? '0 0 0.75rem' : '0 2rem 0.75rem', fontSize: '0.75rem' }}>
          {showHsnSummary && hsnRows.length > 0 && (
            <HsnSummaryTable ctx={{ hsnRows, isIndia, isInterstate, taxLabel, totals }} />
          )}
          {showTaxInWords && totalTax > 0 && (
            <p data-pdf-page-boundary="" style={{ margin: '0.35rem 0 0' }}>
              Tax amount (in words): <strong>{currencySymbol === 'INR' ? numberToWords(totalTax) : amountInWords(totalTax)}</strong>
            </p>
          )}
        </div>
      ) : null}

      {/* Reverse-charge declaration (India) — printed prominently between the
          tax block and the footer when the seller has flagged this invoice as
          RCM. The buyer is responsible for paying GST under Section 9(3)/9(4). */}
      {options.reverseCharge && isIndia && showGST && (
        <div style={{ margin: '0 2rem 0.5rem', padding: '0.5rem 0.75rem', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 4, fontSize: '0.78rem', color: 'var(--warn-text)' }}>
          <strong>Reverse Charge applicable.</strong> GST is payable by the recipient under Section 9(3)/9(4) of the CGST Act.
        </div>
      )}

      {/* Composition-scheme mandatory declaration — Rule 46A of CGST Rules. The
          exact wording is prescribed; do not paraphrase. */}
      {invoiceType === 'composition' && (
        <div style={{ margin: '0 2rem 0.5rem', padding: '0.5rem 0.75rem', background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 4, fontSize: '0.78rem', color: 'var(--info-text)', fontStyle: 'italic' }}>
          "Composition taxable person, not eligible to collect tax on supplies."
          &nbsp;<span style={{ fontStyle: 'normal', fontSize: '0.7rem' }}>(Rule 46A, CGST Rules)</span>
        </div>
      )}

      {/* Footer */}
      <div className="inv-footer" style={pdfStyle !== 'classic' ? { padding: '1rem 2rem' } : {}}>
        <div className="inv-footer-left">
          {/* Bank details render from the resolved payment account. Account fields
              fall back to the flat profile fields when neither array entry nor flat
              field exists — guarantees byte-identical PDFs for v1.4.3 invoices. */}
          {showBankDetails && (account?.bankName || profile?.bankName) && (
            <div className="inv-footer-block">
              <h4 className="inv-section-label">{getLabel(_ps_labels, 'bankDetails')}</h4>
              {showAccountLabel && account?.label && (
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
                  Pay via: <strong style={{ color: '#334155' }}>{account.label}</strong>
                </p>
              )}
              <div className="inv-footer-details">
                {/* v1.10.37 — Account Holder Name renders FIRST (above
                    Bank) because clients doing NEFT/RTGS need it for
                    beneficiary lookup — printing it prominently
                    prevents the "name mismatch" payment failures
                    reported by users. Falls back to businessName when
                    the field is blank so existing accounts render the
                    same as before. */}
                {(account?.accountHolderName || profile?.businessName) && (
                  <p><span className="inv-detail-label">A/C Name:</span> {account?.accountHolderName || profile.businessName}</p>
                )}
                <p><span className="inv-detail-label">Bank:</span> {account?.bankName || profile.bankName}</p>
                <p><span className="inv-detail-label">A/C No:</span> {account?.accountNumber || profile.accountNumber}
                  {/* v1.10.37 — Account type appended inline next to
                      the number so it doesn't add a whole extra row on
                      the PDF. Uses the human label for CC/OD which
                      won't parse well as an abbreviation to non-banking
                      readers. */}
                  {account?.accountType && (
                    <span style={{ marginLeft: '0.4rem', fontSize: '0.85em', color: '#64748b' }}>
                      · {({ savings: 'Savings', current: 'Current', cc: 'Cash Credit', od: 'Overdraft', nre: 'NRE', nro: 'NRO' })[account.accountType] || account.accountType}
                    </span>
                  )}
                </p>
                {(account?.ifsc || profile.ifsc) && <p><span className="inv-detail-label">{sellerCC.bankLabel || 'IFSC'}:</span> {account?.ifsc || profile.ifsc}</p>}
                {(account?.swift || profile.swift) && <p><span className="inv-detail-label">SWIFT/BIC:</span> {account?.swift || profile.swift}</p>}
                {profile.pan && isIndia && <p><span className="inv-detail-label">PAN:</span> {profile.pan}</p>}
              </div>
            </div>
          )}
          {options.exchangeRate && currencySymbol !== 'INR' && (
            <div className="inv-footer-block">
              <h4 className="inv-section-label">EXCHANGE RATE</h4>
              <p className="inv-terms">{formatExchangeRateLine(currencySymbol, options.exchangeRate, profile?.country === 'India' || !profile?.country ? 'INR' : sellerCC.currency)}</p>
            </div>
          )}
          {/* Terms and notes accept rich HTML; same DOMPurify sanitization the extraSections
              block uses, which keeps b/i/u/lists/links/headings and strips everything else.
              v1.10.5 — audit M25 fix. `termsSeparatePage` was a saved
              setting the UI toggled but nothing consumed. Now: when
              true, T&C + notes render inside a `data-pdf-page` container
              (same mechanism the extraSections feature uses). buildPDF's
              extraPages loop then captures it as its own PDF page. */}
          {!_ps.termsSeparatePage && (() => {
            const termsHtml = customTerms ? splitNumberedTerms(DOMPurify.sanitize(customTerms)) : '';
            const hasTerms = htmlHasText(termsHtml);
            return showTerms && hasTerms ? (
              <div className="inv-footer-block">
                <h4 className="inv-section-label">{getLabel(_ps_labels, 'terms')}</h4>
                <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: termsHtml }} />
              </div>
            ) : null;
          })()}
          {!_ps.termsSeparatePage && (() => {
            const notesHtml = customNotes ? splitNumberedTerms(DOMPurify.sanitize(customNotes)) : '';
            const hasNotes = htmlHasText(notesHtml);
            return showNotes && hasNotes ? (
              <div className="inv-footer-block">
                <h4 className="inv-section-label">{getLabel(_ps_labels, 'notes')}</h4>
                <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: notesHtml }} />
              </div>
            ) : null;
          })()}
          {/* v1.10.70 (#72) - below Terms & Conditions, as asked. */}
          {showSystemGeneratedNote && (
            <div className="inv-footer-block inv-system-note">
              <p className="inv-terms" style={{ margin: 0, fontStyle: 'italic' }}>
                <strong>Note:</strong> This is a system-generated invoice. No signature or stamp is required.
              </p>
            </div>
          )}
          {showDeclaration && (
            <div className="inv-footer-block">
              <h4 className="inv-section-label">DECLARATION</h4>
              <p className="inv-terms" style={{ margin: 0 }}>{declarationText}</p>
            </div>
          )}
        </div>
        {/* v1.10.5 — Separate T&C page. Uses the same data-pdf-page
             attribute the extraSections feature uses, so buildPDF's
             existing extraPages loop captures it on its own page. */}
        {_ps.termsSeparatePage && (customTerms || customNotes) && (
          <div data-pdf-page="terms" style={{ padding: '2rem', pageBreakBefore: 'always', breakBefore: 'page' }}>
            {(() => {
              const termsHtml = customTerms ? splitNumberedTerms(DOMPurify.sanitize(customTerms)) : '';
              const hasTerms = htmlHasText(termsHtml);
              return showTerms && hasTerms ? (
                <div className="inv-footer-block">
                  <h4 className="inv-section-label">{getLabel(_ps_labels, 'terms')}</h4>
                  <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: termsHtml }} />
                </div>
              ) : null;
            })()}
            {(() => {
              const notesHtml = customNotes ? splitNumberedTerms(DOMPurify.sanitize(customNotes)) : '';
              const hasNotes = htmlHasText(notesHtml);
              return showNotes && hasNotes ? (
                <div className="inv-footer-block" style={{ marginTop: '2rem' }}>
                  <h4 className="inv-section-label">{getLabel(_ps_labels, 'notes')}</h4>
                  <div className={`inv-terms inv-rich ${termsClassMod}`} dangerouslySetInnerHTML={{ __html: notesHtml }} />
                </div>
              ) : null;
            })()}
          </div>
        )}
        {(() => {
          // v1.9.0: signature source priority — profile.signature (per-business,
          // legacy), then printSettings.signatureImage (app-wide default set
          // via Print Settings). Same for the signatory name.
          const printCfg = _ps;  // v1.10.4 — reuse top-of-function read
          const sigImg = profile?.signature || (printCfg.signatureShow !== false ? printCfg.signatureImage : null);
          const sigName = profile?.businessName || printCfg.signatureName;
          // v1.10.67 (#66 item 13) — the stamp is a separate image with its own
          // height, so it no longer has to be pasted into the signature file.
          // Either one alone is enough to print the block.
          const stampImg = profile?.stamp || null;
          const sigMaxHeight = Number(profile?.signatureHeight) || 60;
          const stampMaxHeight = Number(profile?.stampHeight) || 70;
          if (!showSignature || (!sigImg && !stampImg)) return null;
          return (
            <div className="inv-signature">
              {showSignatoryText && <p className="inv-sig-label">{getLabel(_ps_labels, 'authorizedSignatory')}</p>}
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                {stampImg && <img src={stampImg} alt="Stamp" style={{
                  maxHeight: `${stampMaxHeight}px`, maxWidth: '120px', objectFit: 'contain', display: 'block',
                }} />}
                {sigImg && <img src={sigImg} alt="Signature" style={{
                  maxHeight: `${sigMaxHeight}px`, maxWidth: '180px', objectFit: 'contain', display: 'block',
                }} />}
              </div>
              <p className="inv-sig-name">{sigName}</p>
            </div>
          );
        })()}
      </div>
      </>)}

      {/* Extra Sections - each starts on new page */}
      {(() => {
        const filtered = extraSections.filter(s => s.title || s.content);
        // v1.10.74 - dropped "Page N of M": M assumed a one-page invoice, so it
        // was wrong whenever the invoice itself ran longer.
        return filtered.map((section, idx) => (
          <div key={section.id} className="inv-extra-page" data-pdf-page={idx + 2}>
            <div className="inv-extra-page-header">
              <div>
                <span className="inv-extra-ref">{customTitle} — {details?.invoiceNumber}</span>
                {client?.name && <span className="inv-extra-ref"> | {client.name}</span>}
              </div>
            </div>
            {section.title && <h4 className="inv-section-label" style={{ marginBottom: '0.75rem' }}>{section.title.toUpperCase()}</h4>}
            {section.content && (
              <div className="inv-extra-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(section.content) }} />
            )}
          </div>
        ));
      })()}

      {/* Watermark for proforma */}
      {invoiceType === 'proforma' && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%) rotate(-35deg)',
          fontSize: '5rem', fontWeight: 800, color: `${accent}0a`,
          pointerEvents: 'none', whiteSpace: 'nowrap'
        }}>
          ESTIMATE
        </div>
      )}

      {/* Bottom bar for modern style */}
      {pdfStyle === 'modern' && (
        <div style={{ height: '4px', background: accent, marginTop: 'auto' }} />
      )}
    </div>
  );
});

export default InvoicePreview;
