import React from 'react';
import DOMPurify from 'dompurify';
import { INVOICE_TYPES, resolveLineDiscount } from '../utils';

// ============================================================================
// InvoicePreview - SINGLE TEMPLATE: ADA INTERIORS (A4, ruled industrial GST
// tax invoice). There are no presets, colour overrides, fonts, letterhead or
// thermal layouts any more - this component always renders the layout below.
//
// Props are kept identical to the old component so parents (InvoiceGenerator,
// PrintPreviewModal, PrintSettings ...) keep working without changes:
//   profile, client, details, items, totals, invoiceType, customTerms,
//   customNotes, extraSections, options, previewOnly, cancelled
//
// Copies: by default 3 A4 pages are rendered, each with its OWN label right
// under "<<TAX INVOICE>>":
//   1. (Original For Recipient)  2. (Duplicate For Transporter)
//   3. (Triplicate For Supplier)
// Set options.printCopies = 1 (or 2) to render fewer copies. The PDF builder in
// InvoiceGenerator captures every .ada-page as exactly ONE A4 sheet.
// ============================================================================

const SELLER = {
  gstNo: '03CYQPK1275H1ZB',
  panNo: 'CYQPK1275H',
  name: 'ADA INTERIORS',
  address: '#22/3, RANCHI COLONY, NR RAILWAY LINE, THREEKE ROAD, LUDHIANA',
  phones: ['83600-93750', '99885-04240'],
  bank: {
    name: 'PUNJAB NATIONAL BANK',
    acNo: '1798002100001203',
    ifsc: 'PUNB0179800',
    branch: 'BAREWAL LUDHIANA',
  },
};

const COPY_LABELS = [
  '(Original For Recipient)',
  '(Duplicate For Transporter)',
  '(Triplicate For Supplier)',
];

const DEFAULT_TERMS = [
  'Goods once sold will not be taken back.',
  'Interest @ 24% p.a will be charged  if bill is not paid within 30 days.',
  'Subject to Ludhiana Jurisdiction Only.',
];

// column widths (%) - must add up to exactly 100
const COLS = [4.5, 25.5, 8.5, 5.5, 9.5, 8.5, 11, 5.5, 8, 5.5, 8];
// vertical grid lines (% from left): after S.No, Description, HSN, Unit, Qty, Rate, Amount, SGST
const VLINES = [4.5, 30, 38.5, 44, 53.5, 62, 73, 86.5];

const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v) || 0);
const money = (v) => num(v).toFixed(2);
const qtyFmt = (v) => num(v).toFixed(3);

const fmtDate = (v) => {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// ---------- amount in words (Indian system) ----------
const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
const twoDigits = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`);
const threeDigits = (n) =>
  `${n >= 100 ? ONES[Math.floor(n / 100)] + ' HUNDRED' : ''}${n % 100 ? (n >= 100 ? ' ' : '') + twoDigits(n % 100) : ''}`;

const rupeesInWords = (value) => {
  const total = Math.round(num(value) * 100);
  let rupees = Math.floor(total / 100);
  const paise = total % 100;
  if (rupees === 0 && paise === 0) return 'RUPEES ZERO ONLY';
  const parts = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(`${threeDigits(crore)} CRORE`);
  if (lakh) parts.push(`${twoDigits(lakh)} LAKH`);
  if (thousand) parts.push(`${twoDigits(thousand)} THOUSAND`);
  if (rupees) parts.push(threeDigits(rupees));
  let words = `RUPEES ${parts.join(' ')}`.trim();
  if (paise) words += ` AND ${twoDigits(paise)} PAISE`;
  return `${words}  ONLY`;
};

// Terms & Conditions: take the invoice's own terms (rich text) as up to 3
// plain lines; fall back to the standard 3 lines.
const termLines = (html) => {
  if (!html) return DEFAULT_TERMS;
  const clean = DOMPurify.sanitize(html).replace(/<\/(p|div|li)>|<br\s*\/?>/gi, '\n');
  const text = typeof DOMParser !== 'undefined'
    ? (new DOMParser().parseFromString(clean, 'text/html').body.textContent || '')
    : clean.replace(/<[^>]+>/g, '');
  const lines = text.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean).slice(0, 3);
  return lines.length ? lines : DEFAULT_TERMS;
};

const InvoicePreview = React.forwardRef(({
  profile: _profile, client, details, items = [], totals = {}, invoiceType = 'tax-invoice',
  customTerms, customNotes: _customNotes, extraSections: _extraSections = [], options = {},
  previewOnly = false, cancelled = false,
}, ref) => {
  const typeConfig = INVOICE_TYPES[invoiceType] || INVOICE_TYPES['tax-invoice'];
  const showGST = options.showGST !== undefined ? options.showGST : typeConfig.showGST;

  // ---- per-line calculation (same maths as the rest of the app) ----
  const rows = (items || []).map((it) => {
    const inclusive = totals?.taxInclusive && showGST;
    const discount = resolveLineDiscount(it, inclusive || !showGST);
    const gross = Math.max(0, (Number(it.quantity) || 0) * (Number(it.rate) || 0) - discount);
    const rate = Number(it.taxPercent) || 0;
    const taxable = inclusive ? gross / (1 + rate / 100) : gross;
    const tax = !showGST ? 0 : (inclusive ? gross - taxable : (taxable * rate) / 100);
    return {
      name: it.name || it.description || '',
      hsn: it.hsn || '',
      unit: it.unit || '',
      qty: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
      amount: taxable,
      sgstPct: rate / 2, sgstAmt: tax / 2,
      cgstPct: rate / 2, cgstAmt: tax / 2,
    };
  });

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const lineTax = rows.reduce((s, r) => s + r.sgstAmt + r.cgstAmt, 0);
  const gstSum = num(totals?.cgst) + num(totals?.sgst) + num(totals?.utgst) + num(totals?.igst);
  const halfTax = (gstSum > 0 ? gstSum : lineTax) / 2;
  const grandTotal = totals?.total !== undefined ? num(totals.total) : Math.round(totalAmount + halfTax * 2);
  const roundOff = totals?.roundOff !== undefined ? num(totals.roundOff) : grandTotal - (totalAmount + halfTax * 2);
  const words = rupeesInWords(grandTotal);
  // Advance / client credit applied on this invoice (set by InvoiceGenerator)
  const appliedCredit = num(totals?.appliedCredit);
  const netPayable = totals?.netPayable !== undefined
    ? num(totals.netPayable)
    : Math.max(0, grandTotal - appliedCredit);
  const terms = termLines(customTerms);

  // ---- client block ----
  const gst = client?.gstin || '';
  const clientAddr = [client?.address, [client?.city, client?.pin].filter(Boolean).join(' - ')]
    .filter(Boolean).join(', ');
  const stateCode = /^\d{2}/.test(gst) ? gst.slice(0, 2) : '03';
  const stateName = client?.state || 'Punjab';
  const deliveryAt = details?.shipToSameAsBilling === false
    ? [details?.shippingAddress, details?.shippingCity, details?.shippingState].filter(Boolean).join(', ')
    : '';

  const requestedCopies = Number(options.printCopies);
  const copyCount = (requestedCopies >= 1 && requestedCopies <= 3) ? requestedCopies : 3;
  const copies = COPY_LABELS.slice(0, copyCount);

  return (
    <div
      className="invoice-preview-container ada-root"
      ref={ref}
      {...(previewOnly ? {} : { id: 'invoice-preview' })}
      style={{ width: '210mm', position: 'relative', background: '#fff' }}
    >
      <style>{CSS}</style>

      {copies.map((copyLabel, copyIdx) => (
        <div
          key={copyLabel}
          className={`ada-page${copyIdx < copies.length - 1 ? ' ada-page-break' : ''}`}
          data-pdf-page={`copy-${copyIdx + 1}`}
        >
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
          <div className="ada-sheet">
            {/* ---------------- HEADER ---------------- */}
            <div className="ada-header">
              <div className="ada-header-top">
                <div className="ada-hl">
                  <div className="ada-idbox"><b>GST NO :</b> {SELLER.gstNo}</div>
                  <div className="ada-idbox"><b>PAN NO :</b> {SELLER.panNo}</div>
                </div>
                <div className="ada-hc">
                  <div className="ada-frame">
                    <div className="ada-frame-title">&lt;&lt;TAX INVOICE&gt;&gt;</div>
                    <div className="ada-frame-sub">{copyLabel}</div>
                  </div>
                </div>
                <div className="ada-hr">
                  <div><b>Ph. :</b> {SELLER.phones[0]},</div>
                  <div>{SELLER.phones[1]}</div>
                </div>
              </div>

              <div className="ada-brand">{SELLER.name}</div>
              <div className="ada-address">{SELLER.address}</div>
              <div className="ada-credit">CREDIT</div>
            </div>

            {/* ---------------- UPPER SPLIT BOX ---------------- */}
            <div className="ada-split">
              <div className="ada-split-left">
                <div className="ada-client">
                  <span className="ada-ms">M/s</span>
                  <div className="ada-client-main">
                    <div className="ada-client-name">{client?.name || ''}</div>
                    <div className="ada-client-addr">{clientAddr}</div>
                  </div>
                  <div className="ada-state">
                    <span className="ada-state-code">{stateCode}</span>
                    <span className="ada-state-name">{stateName}</span>
                  </div>
                </div>
                <div className="ada-client-gst"><b>GST NO. :</b> <b>{gst}</b></div>
                <div className="ada-delivery">Delivery At : {deliveryAt}</div>
              </div>

              <div className="ada-split-right">
                <div className="ada-rrow ada-rrow-2">
                  <div>Invoice No. : <span className="ada-mono">{details?.invoiceNumber || ''}</span></div>
                  <div>Dated : <span className="ada-mono">{fmtDate(details?.invoiceDate)}</span></div>
                </div>
                <div className="ada-rrow ada-rrow-2">
                  <div>GR No. : {details?.grNo || ''}</div>
                  <div>Dt. : {details?.grDate ? fmtDate(details.grDate) : '/ /'}</div>
                </div>
                <div className="ada-rrow">Transport : {details?.transport || ''}</div>
                <div className="ada-rrow">Vehicle No. : {details?.vehicleNo || ''}</div>
                <div className="ada-rrow">P. Mark : {details?.pMark || ''}</div>
                <div className="ada-rrow ada-rrow-last"><b>Electronic Reference No. :</b> {details?.eRefNo || ''}</div>
              </div>
            </div>

            {/* ---------------- ITEMS TABLE ---------------- */}
            <div className="ada-items">
              <div className="ada-vlines" aria-hidden="true">
                {VLINES.map((left) => (<i key={left} style={{ left: `${left}%` }} />))}
              </div>

              <table className="ada-table">
                <colgroup>{COLS.map((w, i) => (<col key={i} style={{ width: `${w}%` }} />))}</colgroup>
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
                  {rows.map((it, idx) => (
                    <tr key={idx} className="ada-item-row">
                      <td className="ada-r">{idx + 1}</td>
                      <td>{it.name}</td>
                      <td>{it.hsn}</td>
                      <td>{it.unit}</td>
                      <td className="ada-r">{qtyFmt(it.qty)}</td>
                      <td className="ada-r">{money(it.rate)}</td>
                      <td className="ada-r">{money(it.amount)}</td>
                      <td className="ada-sm">{num(it.sgstPct).toFixed(1)}%</td>
                      <td className="ada-r">{money(it.sgstAmt)}</td>
                      <td className="ada-sm">{num(it.cgstPct).toFixed(1)}%</td>
                      <td className="ada-r">{money(it.cgstAmt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* empty space - keeps the grid borders running to the bottom of the block */}
              <div className="ada-spacer" />

              <table className="ada-table ada-total-table">
                <colgroup>{COLS.map((w, i) => (<col key={i} style={{ width: `${w}%` }} />))}</colgroup>
                <tbody>
                  <tr>
                    <td /><td className="ada-total-label">Total</td><td /><td />
                    <td className="ada-r">{qtyFmt(totalQty)}</td>
                    <td />
                    <td className="ada-r">{money(totalAmount)}</td>
                    <td /><td /><td /><td />
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ---------------- BANK + TOTALS ---------------- */}
            <div className="ada-foot">
              <div className="ada-foot-left">
                <div className="ada-reverse">Reverse Charge Not Applicable</div>
                <div className="ada-bank">
                  <div>{SELLER.bank.name}</div>
                  <div>A/C NO : {SELLER.bank.acNo}</div>
                  <div>IFSC CODE : {SELLER.bank.ifsc}</div>
                  <div>BRANCH : {SELLER.bank.branch}</div>
                </div>
                <div className="ada-bank-gap" />
              </div>

              <div className="ada-foot-right">
                <div className="ada-calc ada-calc-top"><span /><span /></div>
                <div className="ada-calc"><span>TAXABLE AMOUNT</span><span className="ada-r">{money(totalAmount)}</span></div>
                <div className="ada-calc ada-calc-tax">
                  <span>ADD SGST<br />ADD CGST</span>
                  <span className="ada-r">{money(halfTax)}<br />{money(halfTax)}</span>
                </div>
                <div className="ada-calc ada-calc-round"><span>ROUND OFF(+/-)</span><span className="ada-r">{money(roundOff)}</span></div>
                <div className="ada-calc ada-grand"><span className="ada-r">GRAND TOTAL</span><span className="ada-r">{money(grandTotal)}</span></div>
                {appliedCredit > 0.005 && (
                  <>
                    <div className="ada-calc ada-adv"><span className="ada-r">LESS: ADVANCE RECEIVED</span><span className="ada-r">{money(appliedCredit)}</span></div>
                    <div className="ada-calc ada-net"><span className="ada-r">NET PAYABLE</span><span className="ada-r">{money(netPayable)}</span></div>
                  </>
                )}
              </div>
            </div>

            <div className="ada-words"><b>Amount in Words : {words}</b></div>

            {/* ---------------- TERMS + SIGNATURES ---------------- */}
            <div className="ada-bottom">
              <div className="ada-bottom-top">
                <div className="ada-terms">
                  <div>Terms &amp; Conditions :</div>
                  {terms.map((tm, i) => (<div key={i}>{i + 1}. {tm}</div>))}
                </div>
                <div className="ada-for"><b>For {SELLER.name}</b></div>
              </div>
              <div className="ada-sign-row">
                <b>E. &amp; O. E.</b>
                <b className="ada-receiver">Receiver's Signature</b>
                <b>Authorised Signatory</b>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

// ----------------------------------------------------------------------------
const CSS = `
.ada-root, .ada-root * { box-sizing: border-box; }
.ada-page {
  position: relative;
  width: 210mm;
  min-height: 297mm;
  padding: 8mm;
  background: #fff;
  color: #000;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12px;
  line-height: 1.3;
  display: flex;
  flex-direction: column;
}
.ada-sheet { border: 1.5px solid #000; flex: 1 1 auto; display: flex; flex-direction: column; }
.ada-r { text-align: right; }
.ada-mono { font-family: 'Courier New', monospace; font-size: 13px; font-weight: 700; }

@media print {
  /* The 8mm gap around the frame is the page margin. The app-wide print rule
     sets @page margin to 0, so the margin is kept here, inside the page. */
  .ada-page { width: 210mm; min-height: 296mm; padding: 8mm; margin: 0; }
  .ada-page-break { page-break-after: always; break-after: page; }
  .ada-sheet { break-inside: avoid; }
  .ada-root, .ada-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}

/* header */
.ada-header { position: relative; padding: 6px 8px 0; border-bottom: 1.5px solid #000; }
.ada-header-top { display: grid; grid-template-columns: 1fr 1.2fr 1fr; align-items: start; }
.ada-idbox { font-weight: 700; font-size: 13px; line-height: 1.35; }
.ada-hc { display: flex; justify-content: center; }
.ada-frame { border: 1px solid #000; padding: 2px 14px; text-align: center; }
.ada-frame-title { font-weight: 700; font-size: 15px; }
.ada-frame-sub { font-weight: 700; font-size: 11px; }
.ada-hr { text-align: right; font-weight: 700; font-size: 13px; line-height: 1.5; }
.ada-brand { text-align: center; font-size: 38px; font-weight: 800; font-style: italic; letter-spacing: -0.5px; margin-top: 2px; }
.ada-address { text-align: center; font-weight: 700; font-size: 14px; margin: 10px 0 4px; line-height: 1.35; }
.ada-credit { text-align: right; font-weight: 800; font-size: 14px; padding: 0 0 3px; }

/* upper split */
.ada-split { display: grid; grid-template-columns: 57% 43%; border-bottom: 1.5px solid #000; }
.ada-split-left { border-right: 1.5px solid #000; display: flex; flex-direction: column; }
.ada-client { display: flex; gap: 10px; padding: 4px 8px; min-height: 64px; align-items: flex-start; }
.ada-client-main { flex: 1 1 auto; min-width: 0; }
.ada-ms { font-size: 13px; }
.ada-client-name { font-weight: 700; font-size: 14px; }
.ada-client-addr { font-size: 13px; }
.ada-state { display: flex; border: 1px solid #000; width: 34%; height: 24px; align-self: flex-end; flex: 0 0 auto; }
.ada-state-code { width: 28%; border-right: 1px solid #000; text-align: center; line-height: 22px; font-size: 13px; }
.ada-state-name { flex: 1; text-align: center; line-height: 22px; font-size: 13px; }
.ada-client-gst { border-top: 1px solid #000; padding: 3px 8px; font-size: 13px; }
.ada-delivery { border-top: 1px solid #000; padding: 4px 8px; min-height: 44px; font-size: 13px; }

.ada-split-right { display: flex; flex-direction: column; }
.ada-rrow { padding: 3px 6px; font-size: 13px; min-height: 28px; }
.ada-rrow-2 { display: grid; grid-template-columns: 1.3fr 1fr; border-bottom: 1px solid #000; gap: 6px; }
.ada-rrow-last { margin-top: auto; }

/* items: grows to fill the page so the grid always runs to the bottom */
.ada-items { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 430px; border-bottom: 1.5px solid #000; }
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
.ada-grand { border-bottom: 0; background: #e9e9e9; font-weight: 800; border-top: 1.5px solid #000; }

.ada-adv { border-top: 1.5px solid #000; }
.ada-net { border-bottom: 0; font-weight: 800; border-top: 1px solid #000; }
.ada-grand:not(:last-child) { border-bottom: 1px solid #000; }

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

export default InvoicePreview;
