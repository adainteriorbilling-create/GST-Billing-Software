import { useState, useEffect, useRef, useMemo } from 'react';
import { Users, Search, FileText, ChevronDown, ChevronUp, Trash2, X, MessageCircle, Mail, Plus, Edit3, Copy, Upload, Download, Printer } from 'lucide-react';
import HelpButton from './HelpButton';
import { getAllClients, getAllBills, deleteClient, saveClient, deleteBill, saveBill, getProfile, deleteReceipt, applyStockChanges, trashSavedPdf, addClientAdvance, removeClientAdvance } from '../store';
import { formatCurrency, INVOICE_TYPES, markPaidPatch, markUnpaidPatch, salesSign, countsAsSales, isCancelledBill, amountDue, localToday, parseLocalDate, appliedStock, stockDelta } from '../utils';
import { getPrintSettings } from '../utils/printSettings';
import { openWhatsAppShare } from '../utils/share';
import { confirmAction } from './ConfirmModal';
import { toast } from './Toast';

// v1.10.31 — UI-C3: Shared helper to resolve the user's accent color as an
// RGB tuple usable with jsPDF setFillColor / setDrawColor. Falls back to the
// legacy blue (#1e40af = rgb(30, 64, 175)) when the user hasn't customised.
function getAccentRGB() {
  try {
    const ps = getPrintSettings();
    if (ps.userColorsEnabled && ps.pdfAccent) {
      const hex = String(ps.pdfAccent).replace('#', '');
      if (/^[0-9a-f]{6}$/i.test(hex)) {
        return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
      }
    }
  } catch { /* ignore — fall through to default */ }
  return [30, 64, 175];
}
import ClientModal from './ClientModal';

const STATUS_COLORS = {
  unpaid: { label: 'Unpaid', color: '#f59e0b', bg: '#fffbeb' },
  partial: { label: 'Partial', color: '#8b5cf6', bg: '#f5f3ff' },
  paid: { label: 'Paid', color: '#059669', bg: '#ecfdf5' },
  overdue: { label: 'Overdue', color: '#dc2626', bg: '#fef2f2' },
  // v1.10.74 - shown (read-only) on cancelled bills. Cancel / undo from the
  // Dashboard, which also puts the stock back.
  cancelled: { label: 'Cancelled', color: '#64748b', bg: '#f1f5f9' },
};

// ---------------------------------------------------------------------------
// Advance / Credit receipts. Money received from a client with no invoice
// behind it. Kept on the client record (see addClientAdvance in store.js).
// ---------------------------------------------------------------------------
const ADVANCE_MODES = ['Cash', 'UPI', 'NetBanking'];

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// 1234.5 -> "One Thousand Two Hundred Thirty Four Rupees and Fifty Paise Only"
// (Indian grouping: crore / lakh / thousand).
function amountInWords(n) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''));
  const three = (x) => (x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  const cents = Math.round((Number(n) || 0) * 100);
  const rupees = Math.floor(cents / 100);
  const paise = cents % 100;
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';
  const parts = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (rest) parts.push(three(rest));
  let words = parts.join(' ');
  if (rupees > 0) words += ' Rupees';
  if (paise > 0) words += (rupees > 0 ? ' and ' : '') + two(paise) + ' Paise';
  return words + ' Only';
}

// Full printable HTML document for one advance receipt. Shown in an iframe
// (preview) and printed from that same iframe, so what you see is what prints.
function buildVoucherHtml({ profile, clientName, client, entry }) {
  const [r, g, b] = getAccentRGB();
  const accent = `rgb(${r}, ${g}, ${b})`;
  const p = profile || {};
  const sellerAddr = [p.address, [p.city, p.state, p.pin].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const dateStr = entry.date ? parseLocalDate(entry.date).toLocaleDateString('en-IN') : '';
  const clientAddr = client ? [client.address, [client.city, client.state, client.pin].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const hasBal = typeof entry.balanceAfter === 'number';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${escHtml(entry.receiptNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; padding: 16px; font-size: 13px; }
  .wrap { border: 1.5px solid ${accent}; border-radius: 6px; max-width: 760px; margin: 0 auto; overflow: hidden; }
  .head { background: ${accent}; color: #fff; padding: 14px 20px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .head h1 { margin: 0; font-size: 18px; letter-spacing: .5px; }
  .head .biz { font-size: 11.5px; opacity: .95; margin-top: 4px; line-height: 1.5; }
  .head .no { text-align: right; font-size: 12px; line-height: 1.6; white-space: nowrap; }
  .body { padding: 18px 20px; }
  .row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px dashed #cbd5e1; }
  .row .k { width: 150px; color: #64748b; font-size: 12px; flex-shrink: 0; }
  .row .v { flex: 1; font-weight: 600; }
  .amt { margin: 16px 0; padding: 12px 16px; border: 1.5px solid ${accent}; border-radius: 6px; background: #f8fafc; display: flex; justify-content: space-between; align-items: center; }
  .amt .lbl { font-size: 12px; color: #64748b; }
  .amt .num { font-size: 22px; font-weight: 700; color: ${accent}; }
  .words { font-size: 12.5px; margin-bottom: 6px; }
  .bal { margin-top: 10px; font-size: 12px; color: #0369a1; font-weight: 600; }
  .sign { display: flex; justify-content: space-between; margin-top: 54px; font-size: 12px; color: #475569; }
  .sign div { border-top: 1px solid #94a3b8; padding-top: 4px; min-width: 170px; text-align: center; }
  .foot { text-align: center; font-size: 10.5px; color: #94a3b8; padding: 10px; border-top: 1px solid #e2e8f0; }
</style></head><body>
<div class="wrap">
  <div class="head">
    <div>
      <h1>PAYMENT RECEIPT &middot; ADVANCE VOUCHER</h1>
      <div class="biz"><strong>${escHtml(p.businessName || '')}</strong><br>${escHtml(sellerAddr)}${p.gstin ? '<br>GSTIN: ' + escHtml(p.gstin) : ''}${p.phone ? '<br>Ph: ' + escHtml(p.phone) : ''}</div>
    </div>
    <div class="no">Receipt No: <strong>${escHtml(entry.receiptNo)}</strong><br>Date: <strong>${escHtml(dateStr)}</strong></div>
  </div>
  <div class="body">
    <div class="row"><div class="k">Received from</div><div class="v">${escHtml(clientName)}${clientAddr ? '<div style="font-weight:400;font-size:12px;color:#475569">' + escHtml(clientAddr) + '</div>' : ''}${client?.gstin ? '<div style="font-weight:400;font-size:12px;color:#475569">GSTIN: ' + escHtml(client.gstin) + '</div>' : ''}</div></div>
    <div class="row"><div class="k">Payment mode</div><div class="v">${escHtml(entry.mode)}</div></div>
    <div class="row"><div class="k">Towards</div><div class="v">${escHtml(entry.description || 'Advance payment')}</div></div>
    <div class="amt"><div><div class="lbl">Amount received</div><div class="words">${escHtml(amountInWords(entry.amount))}</div></div><div class="num">${escHtml(formatCurrency(entry.amount, 'INR'))}</div></div>
    ${hasBal ? `<div class="bal">Total advance / credit available with us after this receipt: ${escHtml(formatCurrency(entry.balanceAfter, 'INR'))}</div>` : ''}
    <div class="sign"><div>Received by (Client)</div><div>For ${escHtml(p.businessName || 'Business')}<br>Authorised Signatory</div></div>
  </div>
  <div class="foot">This is an advance payment receipt, not a tax invoice. Computer-generated.</div>
</div>
</body></html>`;
}

export default function ClientsView({ onEdit, onDuplicate, onNew }) {
  const [clients, setClients] = useState([]);
  const [bills, setBills] = useState([]);
  const [search, setSearch] = useState('');
  const [expandedClient, setExpandedClient] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [modalClient, setModalClient] = useState(null);
  const [editingClientId, setEditingClientId] = useState(null);
  const [profileCountry, setProfileCountry] = useState('');
  // Advance / Credit: which client the modal is for, its form, and the receipt preview.
  const [advanceClient, setAdvanceClient] = useState(null);
  const [advanceForm, setAdvanceForm] = useState({ amount: '', mode: 'Cash', date: '', description: '' });
  const [savingAdvance, setSavingAdvance] = useState(false);
  const [voucher, setVoucher] = useState(null);
  const voucherFrameRef = useRef(null);

  useEffect(() => {
    getProfile().then(p => { if (p?.country) setProfileCountry(p.country); }).catch(() => {});
  }, []);

  const loadData = async () => {
    try {
      const [c, b] = await Promise.all([getAllClients(), getAllBills()]);
      setClients(c);
      setBills(b);
    } catch {
      toast('Failed to load data', 'error');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Client Statement PDF — feature A from v1.6.7 audit ("#1 daily ask when
  // a client disputes a bill"). Produces a single-page account statement:
  // invoice list + credit notes + payments + running balance. Reuses the
  // profile block from InvoicePreview for the seller header so the styling
  // matches the invoice PDFs the client already knows.
  const [profileForStatement, setProfileForStatement] = useState(null);
  useEffect(() => {
    getProfile().then(setProfileForStatement).catch(() => {});
  }, []);

  const generateClientStatement = async (clientName) => {
    const clientBills = getClientBills(clientName);
    if (clientBills.length === 0) {
      toast('No invoices for this client', 'warning');
      return;
    }
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const savedClient = clients.find(c => c.name === clientName) || { name: clientName };
      const stats = getClientStats(clientName);
      const pageW = 210, marginL = 15, marginR = 195, tableW = marginR - marginL; // = 180
      // Helvetica core font can't render Rupee symbol properly — use "Rs." plaintext.
      // Numbers are formatted with Indian digit grouping (2,5,000.00 style).
      const fmt = (n) => {
        const v = Number(n) || 0;
        const abs = Math.abs(v);
        const rounded = abs.toFixed(2);
        const parts = rounded.split('.');
        // Indian grouping: last 3 digits, then groups of 2
        const intPart = parts[0];
        const last3 = intPart.slice(-3);
        const rest = intPart.slice(0, -3);
        const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
        return (v < 0 ? '-' : '') + 'Rs. ' + grouped + '.' + parts[1];
      };

      // ============== HEADER BAND ==============
      doc.setFillColor(...getAccentRGB());
      doc.rect(0, 0, pageW, 22, 'F');
      doc.setTextColor(255); doc.setFontSize(16); doc.setFont('helvetica', 'bold');
      doc.text('CLIENT STATEMENT', pageW / 2, 12, { align: 'center' });
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      doc.text(`Generated ${new Date().toLocaleDateString('en-IN')}  ·  Period: All invoices`, pageW / 2, 18, { align: 'center' });
      doc.setTextColor(0);

      let y = 30;

      // ============== FROM / TO BLOCKS (side-by-side, guaranteed non-overlap) ==============
      const colL = marginL, colR = marginL + tableW / 2 + 5;   // 15 and 100
      const colWidth = tableW / 2 - 5;                          // 85 mm each column

      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(100);
      doc.text('FROM', colL, y);
      doc.text('BILL TO', colR, y);
      doc.setTextColor(0);
      y += 4;

      doc.setFontSize(10); doc.setFont('helvetica', 'bold');
      doc.text(doc.splitTextToSize(profileForStatement?.businessName || '', colWidth), colL, y);
      doc.text(doc.splitTextToSize(savedClient.name || clientName, colWidth), colR, y);
      y += 5;
      doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');

      const sellerLines = [
        profileForStatement?.address,
        [profileForStatement?.city, profileForStatement?.state, profileForStatement?.pin].filter(Boolean).join(', '),
        profileForStatement?.gstin ? `GSTIN: ${profileForStatement.gstin}` : null,
        profileForStatement?.email,
        profileForStatement?.phone ? `Ph: ${profileForStatement.phone}` : null,
      ].filter(Boolean);
      const clientLines = [
        savedClient.address,
        [savedClient.city, savedClient.state, savedClient.pin].filter(Boolean).join(', '),
        savedClient.gstin ? `GSTIN: ${savedClient.gstin}` : null,
        savedClient.email,
        savedClient.phone ? `Ph: ${savedClient.phone}` : null,
      ].filter(Boolean);

      // v1.10.31 — UI-C1 fix: `splitTextToSize` returns an ARRAY of
      // wrapped sub-lines; jsPDF draws each at line-height 4mm but the
      // outer loop only advanced `dy += 4`, so a 2-line-wrapped address
      // collided with the next logical line ("Birnagar / Bhagar" bleed
      // reported in Client Statement). Now dy advances by the actual
      // rendered line count.
      let sellerDy = 0;
      sellerLines.forEach(line => {
        const wrapped = doc.splitTextToSize(line, colWidth);
        doc.text(wrapped, colL, y + sellerDy);
        sellerDy += wrapped.length * 4;
      });
      let clientDy = 0;
      clientLines.forEach(line => {
        const wrapped = doc.splitTextToSize(line, colWidth);
        doc.text(wrapped, colR, y + clientDy);
        clientDy += wrapped.length * 4;
      });
      y += Math.max(sellerDy, clientDy) + 5;

      // ============== SUMMARY STRIP ==============
      doc.setFillColor(241, 245, 249);
      doc.rect(marginL, y, tableW, 16, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.rect(marginL, y, tableW, 16, 'S');

      const cellW = tableW / 4;
      const summaryCells = [
        { label: 'Invoices', value: String(stats.count) },
        { label: 'Total Billed', value: fmt(stats.total) },
        { label: 'Paid', value: fmt(stats.paid), color: [5, 150, 105] },
        { label: 'Outstanding', value: fmt(stats.unpaid), color: stats.unpaid > 0 ? [220, 38, 38] : [5, 150, 105] },
      ];
      summaryCells.forEach((cell, i) => {
        const cx = marginL + i * cellW + cellW / 2;
        doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
        doc.text(cell.label.toUpperCase(), cx, y + 5, { align: 'center' });
        doc.setFontSize(cell.label === 'Invoices' ? 12 : 10); doc.setFont('helvetica', 'bold');
        if (cell.color) doc.setTextColor(...cell.color); else doc.setTextColor(15, 23, 42);
        doc.text(cell.value, cx, y + 12, { align: 'center' });
      });
      doc.setTextColor(0);
      y += 22;

      // ============== LEDGER TABLE (Indian Dr/Cr convention) ==============
      // Columns follow standard Indian business-statement format:
      //   Date | Particulars (invoice # + type) | Debit | Credit | Balance
      // Debit  = amount charged to the client (increases receivable)
      // Credit = payment received / credit note (decreases receivable)
      // Balance = running Dr - Cr
      //
      // v1.10.35 — Column widths widened after a report showed "Dr"
      // suffix crowding the balance number. Prior debitEnd=140 /
      // creditEnd=168 / balanceEnd=193 left only 4mm between Credit
      // and Balance text — tight when both were 5-digit rupee amounts.
      // Now the Particulars column is trimmed by 5mm and that space is
      // distributed into Debit/Credit/Balance so each has proper breathing
      // room and long "Dr/Cr" suffixes never clip the page margin.
      const col = {
        dateEnd: 40,        // Date column: 15 to 40 (25mm — dd/mm/yyyy fits at 8.5pt)
        particEnd: 100,     // Particulars: 40 to 100 (60mm)
        debitEnd: 133,      // Debit right-aligned at 133
        creditEnd: 163,     // Credit right-aligned at 163
        balanceEnd: marginR - 2, // Balance right-aligned at 193
      };

      // Header band
      doc.setFillColor(...getAccentRGB());
      doc.rect(marginL, y, tableW, 9, 'F');
      doc.setTextColor(255); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text('Date', marginL + 2, y + 6);
      doc.text('Particulars', col.dateEnd + 2, y + 6);
      doc.text('Debit', col.debitEnd, y + 6, { align: 'right' });
      doc.text('Credit', col.creditEnd, y + 6, { align: 'right' });
      doc.text('Balance', col.balanceEnd, y + 6, { align: 'right' });
      doc.setTextColor(0);
      y += 11;

      // Opening balance row — italic + muted, above the first real row.
      doc.setFontSize(8.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(80);
      doc.text('Opening Balance', col.dateEnd + 2, y);
      doc.text(fmt(0), col.balanceEnd, y, { align: 'right' });
      // v1.10.35 — thin separator so the opening line reads as a
      // distinct baseline, not as a squished header extension.
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15);
      doc.line(marginL, y + 2, marginR, y + 2);
      doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'normal');
      y += 7;

      // Rows
      let runningBalance = 0;
      // Sales and credit notes only, as in the summary above: quotations,
      // proformas, challans and cancelled invoices are not owed, and listing
      // them as debits gave a closing balance that disagreed with the summary.
      const sortedBills = clientBills.filter((b) => salesSign(b) !== 0)
        .sort((a, b) => parseLocalDate(a.invoiceDate) - parseLocalDate(b.invoiceDate));

      const drawHeader = () => {
        doc.setFillColor(...getAccentRGB());
        doc.rect(marginL, y, tableW, 9, 'F');
        doc.setTextColor(255); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
        doc.text('Date', marginL + 2, y + 6);
        doc.text('Particulars', col.dateEnd + 2, y + 6);
        doc.text('Debit', col.debitEnd, y + 6, { align: 'right' });
        doc.text('Credit', col.creditEnd, y + 6, { align: 'right' });
        doc.text('Balance', col.balanceEnd, y + 6, { align: 'right' });
        doc.setTextColor(0);
        y += 12;   // v1.10.35 — was 11; 1mm extra so text doesn't kiss the header rectangle bottom
      };

      for (let i = 0; i < sortedBills.length; i++) {
        const bill = sortedBills[i];
        const isCreditNote = bill.invoiceType === 'credit-note';
        const amount = Number(bill.totalAmount) || 0;
        const paid = Number(bill.paidAmount) || 0;
        // Compute Dr / Cr for this row
        //   Tax invoice: Dr = amount, Cr = 0
        //   Credit note: Dr = 0, Cr = amount
        //   Then if paid amount > 0 we add ANOTHER row for the payment as Cr
        const debit = isCreditNote ? 0 : amount;
        const credit = isCreditNote ? amount : 0;

        // Page break with header repeat
        if (y > 260) { doc.addPage(); y = 20; drawHeader(); }

        // v1.10.35 — Row rendering rewrite for the reported "shows data
        // in incorrect way" screenshot:
        //   - Row height increased 6mm → 7mm so descenders don't kiss
        //     the next row and the alt-shade rectangle covers the whole
        //     row cleanly.
        //   - Alt shading Y offset fixed (was y-4, showed above the row
        //     text baseline on some renders).
        //   - Empty debit/credit cells render as a light em-dash "—"
        //     instead of a hard hyphen "-", matching the app's cell-empty
        //     convention and reducing visual noise.
        //   - The " Dr" / " Cr" suffix now uses the actual sign — was
        //     always " Dr" even for credit-side balances.
        const rowH = 7;
        if (i % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(marginL, y - rowH + 2, tableW, rowH, 'F');
        }

        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
        // Date
        doc.text(parseLocalDate(bill.invoiceDate).toLocaleDateString('en-IN'), marginL + 2, y);
        // Particulars: invoice # + type label
        const typeLabel = INVOICE_TYPES[bill.invoiceType]?.label || bill.invoiceType || '';
        const particulars = `${bill.invoiceNumber || ''} · ${typeLabel}`;
        const particText = doc.splitTextToSize(particulars, col.particEnd - col.dateEnd - 4);
        doc.text(particText[0] || '', col.dateEnd + 2, y);
        // Debit — em-dash placeholder for empty cells.
        if (debit > 0) {
          doc.text(fmt(debit), col.debitEnd, y, { align: 'right' });
        } else {
          doc.setTextColor(180); doc.text('—', col.debitEnd, y, { align: 'right' }); doc.setTextColor(15, 23, 42);
        }
        // Credit
        if (credit > 0) {
          doc.text(fmt(credit), col.creditEnd, y, { align: 'right' });
        } else {
          doc.setTextColor(180); doc.text('—', col.creditEnd, y, { align: 'right' }); doc.setTextColor(15, 23, 42);
        }
        // Balance — sign determines Dr / Cr suffix. Red for owing (Dr),
        // green for surplus (Cr), black for balanced.
        runningBalance += debit - credit;
        const isDr = runningBalance > 0.01;
        const isCr = runningBalance < -0.01;
        if (isDr) { doc.setFont('helvetica', 'bold'); doc.setTextColor(220, 38, 38); }
        else if (isCr) { doc.setTextColor(5, 150, 105); }
        else { doc.setTextColor(15, 23, 42); }
        const suffix = isDr ? ' Dr' : isCr ? ' Cr' : '';
        doc.text(fmt(Math.abs(runningBalance)) + suffix, col.balanceEnd, y, { align: 'right' });
        doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'normal');
        y += rowH;

        // Add a follow-on row for the payment if any
        if (paid > 0.01 && !isCreditNote) {
          if (y > 265) { doc.addPage(); y = 20; drawHeader(); }
          doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(80);
          doc.text('   Payment recd against above', col.dateEnd + 2, y);
          doc.text(fmt(paid), col.creditEnd, y, { align: 'right' });
          runningBalance -= paid;
          const isDr2 = runningBalance > 0.01;
          const isCr2 = runningBalance < -0.01;
          if (isDr2) { doc.setFont('helvetica', 'bold'); doc.setTextColor(220, 38, 38); }
          else if (isCr2) { doc.setFont('helvetica', 'normal'); doc.setTextColor(5, 150, 105); }
          else { doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 23, 42); }
          const suffix2 = isDr2 ? ' Dr' : isCr2 ? ' Cr' : '';
          doc.text(fmt(Math.abs(runningBalance)) + suffix2, col.balanceEnd, y, { align: 'right' });
          doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'normal');
          y += rowH;
        }
        // TDS the client deducted: settled by their TDS deposit, not owed.
        const tds = isCreditNote ? 0 : Number(bill.data?.totals?.tdsAmount) || 0;
        if (tds > 0.01) {
          if (y > 265) { doc.addPage(); y = 20; drawHeader(); }
          doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(80);
          doc.text('   TDS deducted by client', col.dateEnd + 2, y);
          doc.text(fmt(tds), col.creditEnd, y, { align: 'right' });
          runningBalance -= tds;
          doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 23, 42);
          doc.text(fmt(Math.abs(runningBalance)) + (runningBalance > 0.01 ? ' Dr' : runningBalance < -0.01 ? ' Cr' : ''), col.balanceEnd, y, { align: 'right' });
          y += rowH;
        }
      }

      // ============== CLOSING BALANCE ==============
      // v1.10.14 — the v1.10.11 fix (label at col.debitEnd=140mm) still overlapped
      // for medium/large balances: "CLOSING BALANCE" at 11pt bold is ~33mm wide so
      // its right edge lands at ~173mm, but "Rs. X,XXX.XX Dr" at 12pt right-aligned
      // at balanceEnd (~193mm) has its left edge as far left as ~165mm for 4-digit
      // amounts. Real fix: park the label at marginL (~17mm) — 3x more breathing
      // room and it reads better as a bottom-of-page summary line anyway.
      y += 3;
      doc.setDrawColor(...getAccentRGB()); doc.setLineWidth(0.6);
      doc.line(marginL, y, marginR, y); y += 8;
      doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
      doc.text('CLOSING BALANCE', marginL, y);
      doc.setFontSize(12);
      if (runningBalance > 0.01) doc.setTextColor(220, 38, 38); else doc.setTextColor(5, 150, 105);
      const balanceLabel = fmt(Math.abs(runningBalance)) + (runningBalance > 0.01 ? ' Dr' : (runningBalance < -0.01 ? ' Cr' : ' Nil'));
      doc.text(balanceLabel, col.balanceEnd, y, { align: 'right' });
      doc.setTextColor(0);
      y += 10;
      doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(100);
      doc.text('Dr = amount receivable from client  ·  Cr = amount owed to client', marginL, y);

      // ============== SIGNATURE + FOOTER ==============
      // Signature block (right-aligned)
      y = Math.max(y + 15, 260);
      doc.setDrawColor(150); doc.line(marginR - 55, y, marginR - 2, y);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(80);
      doc.text('Authorised Signatory', marginR - 28, y + 4, { align: 'center' });
      doc.text(profileForStatement?.businessName || '', marginR - 28, y + 8, { align: 'center' });

      doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(120);
      doc.text('Please review and confirm within 7 days. This is a computer-generated statement — no signature required.', pageW / 2, 285, { align: 'center' });
      doc.text('Generated by Free GST Billing Software', pageW / 2, 290, { align: 'center' });

      doc.save(`statement-${clientName.replace(/[^\w]+/g, '-')}-${localToday()}.pdf`);
      toast('Statement PDF generated', 'success');
    } catch (e) {
      toast('Could not generate statement PDF', 'error');
      console.error('generateClientStatement', e);
    }
  };

  // v1.10.59 — reported (#44 item 4, @sangwanmail-eng): "slow moving scroll
  // bar in many tabs, like purchase tab client tab etc."
  //
  // getClientBills() scanned EVERY bill and re-sorted, and getClientStats()
  // called it. Nothing was memoised, so the whole thing re-ran on every
  // render — including every keystroke in the search box. Worse, the client
  // sort below calls getClientStats() from inside its comparator, so a full
  // scan of all bills happened O(n log n) times per render on top of once
  // per rendered row.
  //
  // For 100 clients over 500 bills that is on the order of a third of a
  // million string lowercasings and date parses to paint one frame, which
  // is what made scrolling and typing feel sticky.
  //
  // Now: bills are grouped by client ONCE per change to `bills`, each group
  // sorted once, and per-client totals precomputed in the same pass. Lookups
  // become O(1), so rendering a row and sorting the list are both cheap.
  const billsByClient = useMemo(() => {
    const map = new Map();
    for (const b of bills) {
      const key = (b.clientName || '').toLowerCase();
      let arr = map.get(key);
      if (!arr) { arr = []; map.set(key, arr); }
      arr.push(b);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(b.invoiceDate) - new Date(a.invoiceDate));
    }
    return map;
  }, [bills]);

  const statsByClient = useMemo(() => {
    const map = new Map();
    for (const [key, cBills] of billsByClient) {
      // v1.10.74 - only real sales count; credit notes subtract; quotes,
      // challans, proformas and cancelled bills count for nothing.
      const total = cBills.reduce((s, b) => s + salesSign(b) * (b.totalAmount || 0), 0);
      // TDS clients deduct on sales: not paid to us, not owed either.
      const tds = cBills.reduce((s, b) => s + (salesSign(b) === 1 ? (Number(b.totalAmount) || 0) - amountDue(b) : 0), 0);
      const paid = cBills.reduce((s, b) => {
        if (salesSign(b) !== 1) return s;
        const fromPayments = (b.payments || []).reduce((ps, p) => ps + (Number(p.amount) || 0), 0);
        if (fromPayments > 0) return s + fromPayments;
        if (typeof b.paidAmount === 'number' && b.paidAmount > 0) return s + b.paidAmount;
        if (b.status === 'paid') return s + (b.totalAmount || 0);
        return s;
      }, 0);
      // count: the documents in these totals (sales and credit notes).
      map.set(key, { total, paid, unpaid: total - tds - paid, count: cBills.filter((b) => salesSign(b) !== 0).length });
    }
    return map;
  }, [billsByClient]);

  const EMPTY_BILLS = useMemo(() => [], []);
  const getClientBills = (clientName) =>
    billsByClient.get((clientName || '').toLowerCase()) || EMPTY_BILLS;

  const getClientStats = (clientName) =>
    statsByClient.get((clientName || '').toLowerCase())
    || { total: 0, paid: 0, unpaid: 0, count: 0 };


  // v1.10.22 — Aging analysis: bucket unpaid amounts by how long they've
  // been outstanding. Age = today − dueDate (falls back to invoiceDate
  // when a bill has no explicit due date, since most CA-billed invoices
  // don't set one but are treated as due-on-issue).
  //
  // Buckets: current (0-30 days), 31-60, 61-90, 90+. Reported: "client
  // aging / Statement of Account". Matches Vyapar / Zoho / Tally output.
  const bucketAge = (days) => {
    if (days <= 30) return 'current';
    if (days <= 60) return 'd31_60';
    if (days <= 90) return 'd61_90';
    return 'd90plus';
  };
  const getClientAging = (clientName) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = { current: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    const unpaidBills = [];
    for (const b of getClientBills(clientName)) {
      if (!countsAsSales(b)) continue; // v1.10.74 - quotes / challans / cancelled owe nothing
      const outstanding = amountDue(b) - (b.paidAmount || 0);
      if (outstanding <= 0.01) continue;
      const ref = b.data?.details?.dueDate || b.invoiceDate;
      const dueDate = ref ? parseLocalDate(ref) : today;
      const ageDays = Math.max(0, Math.floor((today - dueDate) / 86400000));
      const bucket = bucketAge(ageDays);
      buckets[bucket] += outstanding;
      buckets.total += outstanding;
      unpaidBills.push({ bill: b, ageDays, outstanding });
    }
    return { buckets, unpaidBills };
  };

  // v1.10.22 — Aging Report PDF: single-page overdue-bucket breakdown
  // (0-30, 31-60, 61-90, 90+ days) plus a per-invoice list showing
  // outstanding + age. Distinct from generateClientStatement above,
  // which is a full ledger with running balance — this is the "how
  // overdue are they?" view accountants ask for during collection calls.
  const generateAgingReport = async (clientName) => {
    try {
      const { jsPDF } = await import('jspdf');
      const { unpaidBills, buckets } = getClientAging(clientName);
      if (unpaidBills.length === 0) {
        toast(`${clientName} has no outstanding balance.`, 'info');
        return;
      }
      const profile = profileForStatement || {};
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const marginL = 15, marginR = 195;
      let y = 20;

      // Header
      doc.setFontSize(18); doc.setFont('helvetica', 'bold');
      doc.text('AGING REPORT', marginL, y); y += 8;
      doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
      doc.text(profile?.businessName || 'Your Business', marginL, y); y += 5;
      if (profile?.address) { doc.text(profile.address, marginL, y); y += 5; }
      if (profile?.gstin)   { doc.text(`GSTIN: ${profile.gstin}`, marginL, y); y += 5; }
      doc.setTextColor(0);
      doc.text(`As of: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, marginR, 20, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(`Client: ${clientName}`, marginR, 26, { align: 'right' });
      doc.setFont('helvetica', 'normal');

      y += 4;
      doc.setDrawColor(...getAccentRGB()); doc.setLineWidth(0.5);
      doc.line(marginL, y, marginR, y); y += 8;

      // Column headers
      doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text('Invoice #',   marginL,         y);
      doc.text('Date',        marginL + 40,    y);
      doc.text('Due',         marginL + 65,    y);
      doc.text('Age',         marginL + 90,    y);
      doc.text('Total',       marginL + 115,   y, { align: 'right' });
      doc.text('Outstanding', marginR,         y, { align: 'right' });
      y += 6;
      doc.setLineWidth(0.2);
      doc.line(marginL, y - 2, marginR, y - 2);

      // Rows
      doc.setFont('helvetica', 'normal');
      const fmt = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      for (const { bill, ageDays, outstanding } of unpaidBills) {
        if (y > 265) { doc.addPage(); y = 20; }
        const due = bill.data?.details?.dueDate ? new Date(bill.data.details.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—';
        const dt = bill.invoiceDate ? new Date(bill.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—';
        doc.text(String(bill.invoiceNumber || '—').slice(0, 24), marginL, y);
        doc.text(dt, marginL + 40, y);
        doc.text(due, marginL + 65, y);
        doc.text(`${ageDays}d`, marginL + 90, y);
        doc.text(fmt(bill.totalAmount), marginL + 115, y, { align: 'right' });
        doc.setTextColor(ageDays > 60 ? 220 : 0, ageDays > 60 ? 38 : 0, ageDays > 60 ? 38 : 0);
        doc.text(fmt(outstanding), marginR, y, { align: 'right' });
        doc.setTextColor(0);
        y += 6;
      }

      // Aging summary
      y += 6;
      doc.setDrawColor(...getAccentRGB()); doc.setLineWidth(0.5);
      doc.line(marginL, y, marginR, y); y += 8;
      doc.setFontSize(10); doc.setFont('helvetica', 'bold');
      doc.text('AGING SUMMARY', marginL, y); y += 8;
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      const bucketRows = [
        ['Current (0–30 days)', buckets.current],
        ['31–60 days',          buckets.d31_60],
        ['61–90 days',          buckets.d61_90],
        ['90+ days (overdue)',  buckets.d90plus],
      ];
      for (const [label, val] of bucketRows) {
        doc.text(label, marginL, y);
        doc.text(fmt(val), marginR, y, { align: 'right' });
        y += 6;
      }
      y += 2;
      doc.setDrawColor(0); doc.setLineWidth(0.3);
      doc.line(marginL, y, marginR, y); y += 6;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('TOTAL OUTSTANDING', marginL, y);
      doc.setTextColor(220, 38, 38);
      doc.text(fmt(buckets.total), marginR, y, { align: 'right' });
      doc.setTextColor(0);

      // v1.10.74 - was named "Statement-..." like the real Statement PDF.
      const filename = `Aging-${clientName.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}-${localToday()}.pdf`;
      doc.save(filename);
      toast(`Aging report for ${clientName} downloaded`, 'success');
    } catch (err) {
      console.error('generateAgingReport failed:', err);
      toast('Could not make the aging report', 'error');
    }
  };

  // Get all unique client names from bills (includes unsaved clients)
  const allClientNames = [...new Set([
    ...clients.map(c => c.name),
    ...bills.map(b => b.clientName).filter(Boolean)
  ])];

  const filteredClients = search.trim()
    ? allClientNames.filter(name => name.toLowerCase().includes(search.toLowerCase()))
    : allClientNames;

  // Sort by outstanding amount
  const sortedClients = [...filteredClients].sort((a, b) => {
    const sa = getClientStats(a);
    const sb = getClientStats(b);
    return sb.unpaid - sa.unpaid;
  });

  const handleDeleteClient = async (id) => {
    const held = Number(clients.find(c => c.id === id)?.creditBalance) || 0;
    if (await confirmAction({
      title: 'Remove this saved client?',
      message: 'Their existing invoices stay untouched — this only removes them from your saved clients list. You can add them again anytime.' + (held > 0.005 ? ` Their advance/credit records (${formatCurrency(held, 'INR')}) are stored on this client and will be removed too.` : ''),
      confirmLabel: 'Remove',
      tone: 'danger',
    })) {
      await deleteClient(id);
      toast('Client removed', 'success');
      loadData();
    }
  };

  const handleDeleteBill = async (id) => {
    if (await confirmAction({
      title: 'Delete this invoice?',
      message: 'The invoice will be moved to Trash for 30 days. Restore it from Settings → Backup Management → Trash bin.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })) {
      // Its stock goes back, as when an invoice is cancelled. The trashed copy
      // records what was put back, so restoring it takes exactly that out again.
      const bill = bills.find((b) => b.id === id);
      const returned = bill?.data ? appliedStock(bill) : {};
      const moves = Object.keys(returned).length > 0;
      try {
        if (moves) await saveBill({ ...bill, data: { ...bill.data, stockApplied: {}, stockReturnedOnDelete: returned } }, { overwrite: true });
        try { await deleteBill(id); }
        catch (err) { if (moves) await saveBill(bill, { overwrite: true }).catch(() => {}); throw err; }
        if (moves) await applyStockChanges(stockDelta(returned, {})).catch(() => toast('Invoice deleted, but its stock could not be put back. Check Products.', 'warning'));
        if (bill) trashSavedPdf(bill).catch(() => {});
        toast('Invoice deleted', 'success'); loadData();
      }
      catch { toast('Failed to delete', 'error'); }
    }
  };

  const changeStatus = async (bill, newStatus) => {
    const updated = { ...bill, status: newStatus };
    if (newStatus === 'paid') Object.assign(updated, markPaidPatch(bill));
    // v1.10.77 (#86) - Unpaid takes back the "Marked paid" payment, as on the Dashboard.
    if (newStatus === 'unpaid') Object.assign(updated, markUnpaidPatch(bill));
    await saveBill(updated, { overwrite: true });
    for (const p of (bill.payments || []).filter((x) => !(updated.payments || []).includes(x))) {
      if (p.id) deleteReceipt(p.id).catch(() => {});
    }
    toast(`Marked as ${STATUS_COLORS[updated.status]?.label || updated.status}`, 'info');
    loadData();
  };

  const openAddClient = (prefill) => {
    setModalClient(prefill || null);
    setEditingClientId(null);
    setShowForm(true);
  };

  const openEditClient = (client) => {
    setModalClient(client);
    setEditingClientId(client.id);
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setModalClient(null); setEditingClientId(null); };

  const csvInputRef = useRef(null);

  const handleCSVImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast('CSV file is empty or has no data rows', 'warning'); return; }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      let imported = 0;
      // v1.10.74 - importing the same file twice made duplicates. Skip names
      // already saved (trimmed, any case), including repeats inside the file.
      let skipped = 0;
      const known = new Set(clients.map(c => (c.name || '').trim().toLowerCase()));
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0) continue;
        const row = {};
        headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
        const name = row.name || row.client || row['client name'] || '';
        if (!name) continue;
        if (known.has(name.toLowerCase())) { skipped++; continue; }
        known.add(name.toLowerCase());
        await saveClient({
          name,
          address: row.address || '',
          state: row.state || '',
          gstin: row.gstin || '',
          email: row.email || '',
          phone: row.phone || '',
        });
        imported++;
      }
      toast(`Imported ${imported} client(s)${skipped ? `, skipped ${skipped} already in your list` : ''}`, 'success');
      loadData();
    } catch {
      toast('Failed to parse CSV file', 'error');
    }
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
      else { current += ch; }
    }
    result.push(current);
    return result;
  };

  const handleModalSave = async (formData) => {
    if (!formData.name.trim()) { toast('Client name is required', 'warning'); return; }
    try {
      // Merge over the saved record so advances / creditBalance survive an edit.
      const existing = editingClientId ? clients.find(c => c.id === editingClientId) : null;
      const data = { ...(existing || {}), ...formData };
      if (editingClientId) data.id = editingClientId;
      await saveClient(data);
      toast(editingClientId ? 'Client updated' : 'Client added', 'success');
      closeForm();
      loadData();
    } catch {
      toast('Failed to save client', 'error');
    }
  };

  // ---- Advance / Credit ---------------------------------------------------
  const openAdvance = (clientName) => {
    setAdvanceForm({ amount: '', mode: 'Cash', date: localToday(), description: '' });
    setAdvanceClient(clientName);
  };

  const openVoucher = (clientName, entry) => {
    const client = clients.find(c => c.name === clientName) || null;
    setVoucher({
      clientName,
      entry,
      html: buildVoucherHtml({ profile: profileForStatement, clientName, client, entry }),
    });
  };

  const handleSaveAdvance = async () => {
    const amount = Math.round((parseFloat(advanceForm.amount) || 0) * 100) / 100;
    if (amount <= 0) { toast('Enter an amount greater than 0', 'warning'); return; }
    if (!advanceForm.date) { toast('Pick a date', 'warning'); return; }
    setSavingAdvance(true);
    try {
      const { client, entry } = await addClientAdvance({
        clientName: advanceClient,
        amount,
        mode: advanceForm.mode,
        date: advanceForm.date,
        description: advanceForm.description.trim(),
      });
      const name = advanceClient;
      setAdvanceClient(null);
      toast(`Advance of ${formatCurrency(amount, 'INR')} saved`, 'success');
      await loadData();
      // Open the receipt straight away. Built from the fresh record, not stale state.
      setVoucher({
        clientName: name,
        entry,
        html: buildVoucherHtml({ profile: profileForStatement, clientName: name, client, entry }),
      });
    } catch (e) {
      console.error('addClientAdvance', e);
      toast('Could not save the advance', 'error');
    } finally {
      setSavingAdvance(false);
    }
  };

  const handleDeleteAdvance = async (savedClient, entry) => {
    if (await confirmAction({
      title: 'Delete this advance receipt?',
      message: `${entry.receiptNo} for ${formatCurrency(entry.amount, 'INR')} will be removed and the client's available credit goes down by that amount.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })) {
      try {
        await removeClientAdvance(savedClient.id, entry.id);
        toast('Advance removed', 'success');
        loadData();
      } catch (e) {
        console.error('removeClientAdvance', e);
        toast('Could not remove the advance', 'error');
      }
    }
  };

  const printVoucher = () => {
    const w = voucherFrameRef.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };

  const shareWhatsApp = (bill) => {
    const msg = `*Invoice ${bill.invoiceNumber}*\nAmount: ${formatCurrency(bill.totalAmount)}\nDate: ${new Date(bill.invoiceDate).toLocaleDateString('en-IN')}\nStatus: ${(bill.status || 'unpaid').toUpperCase()}`;
    openWhatsAppShare(bill.clientPhone, msg);
  };

  const shareEmail = (bill) => {
    const subject = `Invoice ${bill.invoiceNumber}`;
    const body = `Dear ${bill.clientName},\n\nPlease find the details of your invoice:\n\nInvoice No: ${bill.invoiceNumber}\nAmount: ${formatCurrency(bill.totalAmount)}\nDate: ${new Date(bill.invoiceDate).toLocaleDateString('en-IN')}\nDue: ${bill.status === 'paid' ? 'Paid' : 'Pending'}\n\nRegards`;
    // v1.10.74 - address the mail to the client when we have their email.
    const to = (clients.find(c => c.name === bill.clientName)?.email || bill.data?.client?.email || '').trim();
    window.open(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  };

  return (
    <div className="dashboard-container">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div>
            <h1 className="page-title">Clients</h1>
            <p className="page-subtitle">Client-wise invoice ledger and outstanding</p>
          </div>
          <HelpButton title="Clients — how to use" doc="clients">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Click a client name</strong> to see every invoice, payment, and credit note in one place.</li>
              <li><strong>Statement PDF</strong> — a full account ledger with running balance. Send it when a client disputes a bill.</li>
              <li><strong>Aging PDF</strong> — outstanding invoices bucketed by 0-30 / 31-60 / 61-90 / 90+ days. Use it for collection calls.</li>
              <li><strong>Aging strip</strong> — the same buckets inline so you can see who's slow to pay at a glance.</li>
              <li><strong>Import CSV</strong> — bulk-load clients from a spreadsheet (columns: name, address, state, gstin, email, phone). To back up clients, use Settings → Data Management → Export Backup.</li>
              <li><strong>WhatsApp / Email</strong> — quick outreach without leaving the app.</li>
            </ul>
          </HelpButton>
        </div>
        <div className="flex gap-2">
          <input type="file" accept=".csv" ref={csvInputRef} style={{ display: 'none' }} onChange={handleCSVImport} />
          <button className="btn btn-secondary" onClick={() => csvInputRef.current?.click()}>
            <Upload size={16} /> Import CSV
          </button>
          <button className="btn btn-secondary" onClick={() => openAddClient()}>
            <Plus size={18} /> Add Client
          </button>
          <button className="btn btn-primary" onClick={onNew}>
            <FileText size={18} /> New Invoice
          </button>
        </div>
      </div>

      {/* Add/Edit Client Modal */}
      <ClientModal show={showForm} onClose={closeForm} onSave={handleModalSave} client={modalClient} isEditing={!!editingClientId} defaultCountry={profileCountry} />

      {/* Add Advance / Credit modal */}
      {advanceClient && (
        <div className="modal-overlay" onClick={() => !savingAdvance && setAdvanceClient(null)}>
          <div className="modal-content" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>💰 Add Advance / Credit</h3>
              <button className="icon-btn" onClick={() => setAdvanceClient(null)} title="Close" disabled={savingAdvance}><X size={18} /></button>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
              Money received from <strong>{advanceClient}</strong> with no invoice. It is added to their available credit and a receipt is generated.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Amount (₹) *</label>
                <input className="form-input" type="number" min="0" step="0.01" autoFocus placeholder="0.00"
                  value={advanceForm.amount}
                  onChange={e => setAdvanceForm(f => ({ ...f, amount: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveAdvance(); }}
                  style={{ width: '100%', fontSize: '1.1rem', fontWeight: 600 }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Payment mode</label>
                <select className="form-input" value={advanceForm.mode}
                  onChange={e => setAdvanceForm(f => ({ ...f, mode: e.target.value }))} style={{ width: '100%' }}>
                  {ADVANCE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Date</label>
                <input className="form-input" type="date" value={advanceForm.date}
                  onChange={e => setAdvanceForm(f => ({ ...f, date: e.target.value }))} style={{ width: '100%' }} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Description (optional)</label>
                <input className="form-input" type="text" maxLength={140} placeholder="e.g. Advance for work"
                  value={advanceForm.description}
                  onChange={e => setAdvanceForm(f => ({ ...f, description: e.target.value }))} style={{ width: '100%' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button className="btn btn-secondary" onClick={() => setAdvanceClient(null)} disabled={savingAdvance}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveAdvance} disabled={savingAdvance}>
                {savingAdvance ? 'Saving…' : 'Save & Print Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt / voucher preview — opens right after saving, prints from the same frame */}
      {voucher && (
        <div className="modal-overlay" onClick={() => setVoucher(null)}>
          <div className="modal-content" style={{ maxWidth: '820px', width: '94vw' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Receipt {voucher.entry.receiptNo}</h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.9rem' }} onClick={printVoucher}>
                  <Printer size={15} /> Print
                </button>
                <button className="icon-btn" onClick={() => setVoucher(null)} title="Close"><X size={18} /></button>
              </div>
            </div>
            <iframe ref={voucherFrameRef} title="Advance receipt" srcDoc={voucher.html}
              style={{ width: '100%', height: '62vh', border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
              Tip: choose “Save as PDF” in the print dialog to keep or share a PDF copy.
            </p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="glass-panel p-4 mb-6">
        <div className="search-box" style={{ maxWidth: '400px' }}>
          <Search size={16} className="search-icon" />
          <input type="text" placeholder="Search clients..." value={search}
            onChange={e => setSearch(e.target.value)} className="search-input" />
          {search && <button className="icon-btn" onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
      </div>

      {/* Client cards */}
      {sortedClients.length === 0 ? (
        <div className="glass-panel p-6">
          <div className="empty-state">
            <Users size={48} />
            <p>No clients found.</p>
            <button className="btn btn-secondary" onClick={() => openAddClient()} style={{ marginTop: '0.5rem' }}>
              <Plus size={16} /> Add Your First Client
            </button>
          </div>
        </div>
      ) : (
        <div className="client-list">
          {sortedClients.map(clientName => {
            const stats = getClientStats(clientName);
            const savedClient = clients.find(c => c.name === clientName);
            const isExpanded = expandedClient === clientName;
            const clientBills = isExpanded ? getClientBills(clientName) : [];

            return (
              <div key={clientName} className="glass-panel mb-4" style={{ overflow: 'hidden' }}>
                {/* Client header */}
                <div className="client-card-header" onClick={() => setExpandedClient(isExpanded ? null : clientName)}>
                  <div className="client-card-info">
                    <div className="client-avatar">
                      {clientName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="client-card-name">{clientName}</h3>
                      <p className="client-card-meta">
                        {stats.count} invoice{stats.count !== 1 ? 's' : ''}
                        {savedClient?.state ? ` | ${savedClient.state}` : ''}
                        {savedClient?.gstin ? ` | ${savedClient.gstin}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="client-card-stats">
                    <div className="client-stat">
                      <span className="client-stat-label">Total</span>
                      <span className="client-stat-value">{formatCurrency(stats.total)}</span>
                    </div>
                    <div className="client-stat">
                      <span className="client-stat-label">Paid</span>
                      <span className="client-stat-value" style={{ color: '#059669' }}>{formatCurrency(stats.paid)}</span>
                    </div>
                    <div className="client-stat">
                      {/* v1.10.23 — surface overpayment explicitly (was
                          hidden as "Outstanding: ₹0" when paid > total). */}
                      <span className="client-stat-label">
                        {stats.unpaid < -0.005 ? 'Overpaid' : 'Outstanding'}
                      </span>
                      <span className="client-stat-value" style={{ color: stats.unpaid > 0.005 ? '#dc2626' : (stats.unpaid < -0.005 ? '#0369a1' : '#059669') }}>
                        {formatCurrency(Math.abs(stats.unpaid))}
                      </span>
                    </div>
                    {(Number(savedClient?.creditBalance) || 0) > 0.005 && (
                      <div className="client-stat">
                        <span className="client-stat-label">Advance</span>
                        <span className="client-stat-value" style={{ color: '#0369a1' }}>{formatCurrency(savedClient.creditBalance)}</span>
                      </div>
                    )}
                    <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', whiteSpace: 'nowrap' }}
                      onClick={e => { e.stopPropagation(); openAdvance(clientName); }}
                      title="Receive money from this client without an invoice">
                      💰 Add Advance/Credit
                    </button>
                    <div style={{ marginLeft: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {isExpanded ? 'Hide' : 'View'} {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </div>

                {/* Expanded: invoice list */}
                {isExpanded && (
                  <div className="client-invoices">
                    {/* Action bar (right-aligned) — Statement + Aging PDFs. */}
                    <div style={{ padding: '0.5rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                        onClick={() => openAdvance(clientName)}
                        title="Receive money from this client without an invoice">
                        💰 Add Advance/Credit
                      </button>
                      <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                        onClick={() => generateClientStatement(clientName)}
                        title="Account statement: every invoice, credit note, payment, and running balance in one PDF">
                        <Download size={14} /> Statement PDF
                      </button>
                      {/* v1.10.22 — Aging breakdown (0-30 / 31-60 / 61-90 / 90+). */}
                      <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                        onClick={() => generateAgingReport(clientName)}
                        title="Aging report: outstanding invoices bucketed by how overdue they are">
                        <Download size={14} /> Aging PDF
                      </button>
                    </div>

                    {/* v1.10.22 — Aging summary strip: shows the four
                        buckets inline so users get the answer without
                        having to open the PDF. */}
                    {(() => {
                      const { buckets } = getClientAging(clientName);
                      if (buckets.total <= 0.01) return null;
                      const fmt = (n) => formatCurrency(n, 'INR');
                      const cells = [
                        { label: 'Current', val: buckets.current, color: '#059669' },
                        { label: '31-60d',  val: buckets.d31_60,   color: '#d97706' },
                        { label: '61-90d',  val: buckets.d61_90,   color: '#ea580c' },
                        { label: '90+ d',   val: buckets.d90plus,  color: '#dc2626' },
                      ];
                      return (
                        <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem' }}>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Aging:</span>
                          {cells.map(c => (
                            <span key={c.label} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{c.label}</span>
                              <strong style={{ color: c.val > 0 ? c.color : 'var(--text-muted)' }}>{fmt(c.val)}</strong>
                            </span>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Client details */}
                    {savedClient && (savedClient.address || savedClient.city || savedClient.email || savedClient.phone) && (
                      <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {(savedClient.address || savedClient.city || savedClient.pin) && (
                          <span>{[savedClient.address, savedClient.city, savedClient.pin].filter(Boolean).join(', ')}</span>
                        )}
                        {savedClient.email && <span>{savedClient.email}</span>}
                        {savedClient.phone && <span>{savedClient.phone}</span>}
                      </div>
                    )}
                    {/* Advance / Credit receipts for this client */}
                    {(savedClient?.advances || []).length > 0 && (
                      <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <strong style={{ fontSize: '0.85rem' }}>Advance / Credit received</strong>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0369a1' }}>
                            Available credit: {formatCurrency(savedClient.creditBalance || 0, 'INR')}
                          </span>
                        </div>
                        <div className="table-scroll">
                          <table className="data-table" style={{ marginBottom: 0, minWidth: '620px' }}>
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Receipt No.</th>
                                <th>Mode</th>
                                <th>Description</th>
                                <th style={{ textAlign: 'right' }}>Amount</th>
                                <th className="col-center">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...savedClient.advances].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))).map(adv => (
                                <tr key={adv.id}>
                                  <td className="text-muted">{adv.date ? parseLocalDate(adv.date).toLocaleDateString('en-IN') : ''}</td>
                                  <td><span className="invoice-badge">{adv.receiptNo}</span></td>
                                  <td><span className="type-badge">{adv.mode}</span></td>
                                  <td className="text-muted">{adv.description || '—'}</td>
                                  <td className="font-bold" style={{ textAlign: 'right', color: '#0369a1' }}>{formatCurrency(adv.amount, 'INR')}</td>
                                  <td>
                                    <div className="table-actions">
                                      <button className="icon-btn icon-btn-blue" onClick={() => openVoucher(clientName, adv)} title="View / print receipt">
                                        <Printer size={14} />
                                      </button>
                                      <button className="icon-btn icon-btn-red" onClick={() => handleDeleteAdvance(savedClient, adv)} title="Delete advance">
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {clientBills.length === 0 ? (
                      <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                        <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>No invoices for this client yet.</p>
                        <button className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.4rem 1rem' }} onClick={onNew}>
                          <Plus size={15} /> Create Invoice
                        </button>
                      </div>
                    ) : (
                      <div className="table-scroll">
                        <table className="data-table" style={{ marginBottom: 0, minWidth: '750px' }}>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Invoice No.</th>
                              <th>Type</th>
                              <th style={{ textAlign: 'right' }}>Amount</th>
                              <th>Status</th>
                              <th className="col-center">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {clientBills.map(bill => {
                              const status = bill.status || 'unpaid';
                              const sc = STATUS_COLORS[status] || STATUS_COLORS.unpaid;
                              const cancelled = isCancelledBill(bill);
                              const isOverdue = status !== 'paid' && !cancelled && bill.data?.details?.dueDate && new Date(bill.data.details.dueDate) < new Date();
                              return (
                                <tr key={bill.id} className={isOverdue ? 'row-overdue' : ''}>
                                  <td className="text-muted">{new Date(bill.invoiceDate).toLocaleDateString('en-IN')}</td>
                                  <td><span className="invoice-badge">{bill.invoiceNumber}</span></td>
                                  <td><span className="type-badge">{(INVOICE_TYPES[bill.invoiceType || 'tax-invoice'])?.label}</span></td>
                                  <td className="font-bold" style={{ textAlign: 'right' }}>{formatCurrency(bill.totalAmount, bill.currency || bill.data?.invoiceOptions?.currency || 'INR')}</td>
                                  <td>
                                    <select className="status-select" value={isOverdue && status !== 'overdue' ? 'overdue' : status}
                                      style={{ background: sc.bg, color: sc.color, borderColor: sc.color + '44', fontSize: '0.75rem', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid', cursor: 'pointer', fontWeight: 600 }}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => changeStatus(bill, e.target.value)}
                                      disabled={cancelled}
                                      title={cancelled ? 'Undo the cancel from the Dashboard' : undefined}>
                                      {/* v1.10.74 - Cancelled is shown, never picked here (no stock restore in this screen). */}
                                      {Object.entries(STATUS_COLORS).filter(([key]) => cancelled || key !== 'cancelled').map(([key, val]) => (
                                        <option key={key} value={key}>{val.label}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    <div className="table-actions">
                                      {bill.data && (
                                        <button className="icon-btn icon-btn-blue" onClick={() => onEdit(bill)} title="Edit Invoice">
                                          <Edit3 size={14} />
                                        </button>
                                      )}
                                      <button className="icon-btn icon-btn-blue" onClick={() => onDuplicate(bill)} title="Duplicate Invoice">
                                        <Copy size={14} />
                                      </button>
                                      <button className="icon-btn icon-btn-green" onClick={() => shareWhatsApp(bill)} title="WhatsApp">
                                        <MessageCircle size={14} />
                                      </button>
                                      <button className="icon-btn icon-btn-blue" onClick={() => shareEmail(bill)} title="Email">
                                        <Mail size={14} />
                                      </button>
                                      <button className="icon-btn icon-btn-red" onClick={() => handleDeleteBill(bill.id)} title="Delete Invoice">
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="client-actions-bar" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '0.75rem 1.5rem', borderTop: '1px solid var(--border)' }}>
                      {savedClient ? (
                        <>
                          <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }} onClick={() => openEditClient(savedClient)}>
                            <Edit3 size={13} /> Edit Client
                          </button>
                          <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem', color: '#dc2626', borderColor: '#fecaca' }} onClick={() => handleDeleteClient(savedClient.id)}>
                            <Trash2 size={13} /> Delete Client
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }} onClick={() => openAddClient({ name: clientName })}>
                          <Plus size={13} /> Save as Client
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
