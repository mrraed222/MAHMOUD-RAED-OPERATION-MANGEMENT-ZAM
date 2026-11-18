(function (global) {
  'use strict';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);

  async function loadAttachments(visitId) {
    const { data, error } = await global.zamClient
      .from('visit_evidence')
      .select('file_path,file_name,mime_type,action_item_id')
      .eq('visit_id', visitId)
      .order('created_at');
    if (error) throw error;

    return Promise.all((data || []).map(async item => {
      const bucket = item.action_item_id ? 'visit-action-evidence' : 'task-evidence';
      const { data: signed, error: urlError } = await global.zamClient.storage
        .from(bucket)
        .createSignedUrl(item.file_path, 600);
      return {
        name: item.file_name || 'مرفق',
        mime: String(item.mime_type || '').toLowerCase(),
        url: urlError ? null : (signed?.signedUrl || null)
      };
    }));
  }

  function qualityLabel(visit) {
    if (visit.quality_status === 'راسب') return 'راسب في الجودة';
    if (visit.quality_status === 'ناجح') return 'ناجح في الجودة';
    return 'نتيجة الجودة غير محددة';
  }

  function buildPrintableHtml(visit, attachmentRows) {
    const results = (visit.supervisory_visit_results || []).map(result => {
      const subchecks = (result.subchecks || []).map(check =>
        `<li><span>${escapeHtml(check.title || check.code || 'نقطة فرعية')}</span><b>${escapeHtml(check.score)}/10</b></li>`
      ).join('');
      const title = result.visit_checklist_templates?.title || '—';
      const category = result.visit_checklist_templates?.category || '—';
      const score = result.score == null ? 'لا ينطبق' : `${escapeHtml(result.score)}/10`;
      return `<article class="criterion-card"><div class="criterion-heading"><div><span class="category">${escapeHtml(category)}</span><h3>${escapeHtml(title)}</h3></div><span class="criterion-score">${score}</span></div><p class="result-label">${escapeHtml(result.result || '—')}</p>${result.note ? `<p class="note"><b>ملاحظة:</b> ${escapeHtml(result.note)}</p>` : ''}${subchecks ? `<div class="subchecks"><b>النقاط الفرعية:</b><ul>${subchecks}</ul></div>` : ''}</article>`;
    }).join('');

    const actions = (visit.visit_action_items || []).map(action =>
      `<article class="action-card"><div class="criterion-heading"><div><span class="category">${escapeHtml(action.item_type || 'إجراء')}</span><h3>${escapeHtml(action.title || '—')}</h3></div><span class="action-status">${escapeHtml(action.status || '—')}</span></div><p><b>الأولوية:</b> ${escapeHtml(action.priority || '—')} <span class="separator">·</span> <b>المسؤول:</b> ${escapeHtml(action.assigned_role || action.profiles?.full_name || '—')}</p><p><b>الموعد:</b> ${escapeHtml(action.due_date || '—')}</p>${action.description ? `<p class="note"><b>التفاصيل:</b> ${escapeHtml(action.description)}</p>` : ''}</article>`
    ).join('');

    const attachments = attachmentRows.length ? attachmentRows.map(item => {
      if (!item.url) return `<p class="attachment-error">${escapeHtml(item.name)} — تعذر تحميل المرفق.</p>`;
      if (item.mime === 'application/pdf' || !item.mime.startsWith('image/')) {
        return `<p class="attachment-link"><a href="${escapeHtml(item.url)}">فتح المرفق: ${escapeHtml(item.name)}</a></p>`;
      }
      return `<figure class="attachment"><img crossorigin="anonymous" width="660" height="420" src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name)}"><figcaption>${escapeHtml(item.name)}</figcaption></figure>`;
    }).join('') : '<p class="empty">لا توجد مرفقات.</p>';

    const branchName = visit.branches?.name || 'فرع غير محدد';
    const logoUrl = new URL('../assets/logo/zam-logo.png', global.location.href).href;
    const shift = visit.shift_type === 'Morning' ? 'صباحي' : (visit.shift_type === 'Evening' ? 'مسائي' : 'غير محدد');
    const score = visit.score_percentage == null ? '—' : `${Number(visit.score_percentage).toFixed(0)}%`;
    const override = visit.quality_override
      ? `<p class="quality-reason"><b>سبب الرسوب الاستثنائي:</b> ${escapeHtml(visit.quality_override_reason || '—')}</p>`
      : '';

    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>تقرير زيارة ${escapeHtml(branchName)}</title><style>
      @page{size:A4;margin:10mm}
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;width:100%;min-height:100%;background:#fff}
      body{font-family:Tahoma,Arial,sans-serif;color:#24170c;font-size:12px;line-height:1.55}
      .sheet{width:100%;max-width:794px;margin:0 auto;background:#fff;border:1px solid #dfd3c9}
      .cover{background:#33210d;color:#fff;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .cover-copy{min-width:0}.logo{display:block;flex:0 0 100px;width:100px;height:64px;max-width:100px;max-height:64px;object-fit:contain;background:#fff;border-radius:9px;padding:4px}
      .eyebrow{opacity:.82;font-size:10px}.title{font-size:22px;font-weight:800;margin:4px 0}.meta{font-size:11px;opacity:.94}
      .content{padding:18px 20px}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 16px}
      .stat{min-width:0;background:#f7f3ef;border:1px solid #eadfd6;border-radius:9px;padding:9px}.stat b{display:block;font-size:16px;color:#76583d;overflow-wrap:anywhere}.stat span{display:block;margin-top:2px;font-size:9px;color:#71655c}
      .quality-stat{background:#fff8ea}.quality-status{font-size:12px!important}.quality-reason{margin:6px 0 0;font-size:10px;color:#8d332c;overflow-wrap:anywhere}
      .section{margin-top:17px}.section h2{font-size:14px;background:#33210d;color:#fff;border-radius:6px;padding:7px 10px;margin:0 0 8px;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .criterion-card,.action-card{border:1px solid #dfd3c9;border-radius:8px;padding:9px 10px;margin:0 0 7px;break-inside:auto;page-break-inside:auto}
      .criterion-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.criterion-heading>div{min-width:0}.category{font-size:9px;color:#76583d;font-weight:700}.criterion-heading h3{font-size:11px;line-height:1.45;margin:1px 0 0;overflow-wrap:anywhere}
      .criterion-score,.action-status{flex:0 0 auto;border:1px solid #d8c9bb;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800;color:#76583d;white-space:nowrap}
      .result-label{display:inline-block;margin:5px 0 0;background:#f7f3ef;border-radius:4px;padding:2px 6px;font-size:9px;color:#51402f}
      .note,.action-card p{margin:4px 0 0;font-size:10px;overflow-wrap:anywhere;white-space:pre-wrap}.subchecks{margin-top:6px;font-size:9px}.subchecks ul{list-style:none;margin:3px 0 0;padding:0}.subchecks li{display:flex;justify-content:space-between;gap:10px;border-top:1px solid #eee6df;padding:2px 0}
      .separator{padding:0 3px;color:#ad9b8d}.attachments{display:block}.attachment{border:1px solid #dfd3c9;border-radius:8px;padding:8px;margin:0 0 8px;break-inside:auto;page-break-inside:auto}.attachment img{display:block;width:100%;height:auto;max-width:100%;max-height:150mm;object-fit:contain;margin:0 auto}.attachment figcaption{font-size:9px;color:#71655c;margin-top:4px;overflow-wrap:anywhere}.attachment-error,.attachment-link,.empty{font-size:10px;overflow-wrap:anywhere}
      .footer{border-top:1px solid #eadfd6;padding:10px 20px;color:#71655c;font-size:9px;line-height:1.7;overflow-wrap:anywhere}.footer b{color:#33210d}.footer a{color:#33210d;text-decoration:none}
      @media(max-width:620px){.cover{padding:14px}.title{font-size:18px}.content{padding:13px}.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sheet{border:0}}
      @media print{html,body{background:#fff}.sheet{width:100%;max-width:none;margin:0;border:0}.cover,.section h2{print-color-adjust:exact;-webkit-print-color-adjust:exact}.criterion-card,.action-card,.attachment{break-inside:auto;page-break-inside:auto}}
      </style></head><body><div class="sheet"><header class="cover"><div class="cover-copy"><div class="eyebrow">ZAM Operations · تقرير رقابة تشغيلية</div><div class="title">تقرير زيارة فرع</div><div class="meta">${escapeHtml(branchName)} · ${escapeHtml(visit.visit_date || '—')} · ${shift}</div></div><img class="logo" width="100" height="64" src="${escapeHtml(logoUrl)}" alt="شعار زام"></header><main class="content"><div class="summary-grid"><div class="stat"><b>${score}</b><span>النتيجة العامة</span></div><div class="stat"><b>${escapeHtml(visit.score_total ?? '—')} / ${escapeHtml(visit.score_possible ?? '—')}</b><span>الدرجة</span></div><div class="stat"><b>${escapeHtml(visit.visitor_name || '—')}</b><span>المقيّم</span></div><div class="stat quality-stat"><b class="quality-status">${qualityLabel(visit)}</b><span>حالة الجودة</span>${override}</div></div><section class="section"><h2>بنود التقييم ودرجاتها</h2>${results || '<p class="empty">لا توجد بنود تقييم.</p>'}</section><section class="section"><h2>الإجراءات والمخالفات</h2>${actions || '<p class="empty">لا توجد إجراءات مسجلة.</p>'}</section><section class="section"><h2>المرفقات</h2><div class="attachments">${attachments}</div></section><section class="section"><h2>الملاحظات العامة</h2><p>${escapeHtml(visit.observation || 'لا توجد ملاحظات عامة')}</p></section></main><footer class="footer">ZAM Operations · تم إنشاء التقرير من سجل الزيارات.<br>للتواصل: <a href="mailto:operation@zam.sa">operation@zam.sa</a><br><b>اعتماد إلكتروني — محمود شريف — إدارة التشغيل</b></footer></div></body></html>`;
  }

  function waitForAssets(doc) {
    const imagePromises = Array.from(doc.images || []).map(image => {
      if (image.complete) return Promise.resolve();
      return Promise.race([
        new Promise(resolve => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }),
        new Promise(resolve => global.setTimeout(resolve, 10000))
      ]);
    });
    const fonts = doc.fonts?.ready || Promise.resolve();
    return Promise.all([fonts, ...imagePromises]);
  }

  async function buildHtml(visit) {
    const attachmentRows = await loadAttachments(visit.id);
    return buildPrintableHtml(visit, attachmentRows);
  }

  async function renderPageImages(visit) {
    await global.document.fonts?.ready;
    const attachmentRows = await loadAttachments(visit.id);
    const pageWidth = 794;
    const pageHeight = 1123;
    const scale = 1.5;
    const margin = 45;
    const right = pageWidth - margin;
    const contentBottom = 1034;
    const brown = '#33210d';
    const ink = '#24170c';
    const muted = '#71655c';
    const pages = [];
    const branchName = visit.branches?.name || 'فرع غير محدد';
    const shift = visit.shift_type === 'Morning' ? 'صباحي' : (visit.shift_type === 'Evening' ? 'مسائي' : 'غير محدد');
    const visitDate = String(visit.visit_date || '—');
    const quality = qualityLabel(visit);
    const logoUrl = new URL('../assets/logo/zam-logo.png', global.location.href).href;
    let logo = null;
    try {
      const response = await fetch(logoUrl, { credentials: 'same-origin' });
      if (response.ok) logo = await createImageBitmap(await response.blob());
    } catch (_) { /* The report remains usable if the logo cannot be loaded. */ }

    let current;
    let y = 0;

    function setText({ size = 11, bold = false, color = ink, align = 'right', direction = 'rtl' } = {}) {
      const ctx = current.ctx;
      ctx.font = `${bold ? '700' : '400'} ${size}px Arial, sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.direction = direction;
    }

    function wrapLines(value, maxWidth, font, direction = 'rtl') {
      const ctx = current.ctx;
      ctx.font = font;
      ctx.direction = direction;
      const text = String(value ?? '—').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() || '—';
      const words = text.split(' ');
      const lines = [];
      let line = '';
      for (const word of words) {
        if (!line && ctx.measureText(word).width > maxWidth) {
          let fragment = '';
          for (const character of Array.from(word)) {
            const candidate = fragment + character;
            if (fragment && ctx.measureText(candidate).width > maxWidth) {
              lines.push(fragment);
              fragment = character;
            } else fragment = candidate;
          }
          line = fragment;
          continue;
        }
        const candidate = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
      return lines.length ? lines : ['—'];
    }

    function drawText(value, x, baseline, options = {}) {
      setText(options);
      current.ctx.fillText(String(value ?? '—'), x, baseline);
    }

    function createPage(compact = false) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(pageWidth * scale);
      canvas.height = Math.round(pageHeight * scale);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageWidth, pageHeight);
      current = { canvas, ctx };
      pages.push(current);
      const metaWidth = compact ? right - (margin + 58 + 18) : right - (margin + 100 + 22);
      const metaFont = compact ? '400 10px Arial, sans-serif' : '400 12px Arial, sans-serif';
      const meta = wrapLines(`${branchName} · ${visitDate} · ${shift}`, metaWidth, metaFont);
      const metaStart = compact ? 59 : 99;
      const metaStep = compact ? 13 : 15;
      const headerHeight = Math.max(compact ? 82 : 120, metaStart + (meta.length - 1) * metaStep + 12);
      ctx.fillStyle = brown;
      ctx.fillRect(0, 0, pageWidth, headerHeight);
      if (logo) {
        const maxW = compact ? 58 : 100;
        const maxH = compact ? 44 : 72;
        const ratio = Math.min(maxW / logo.width, maxH / logo.height);
        const w = logo.width * ratio;
        const h = logo.height * ratio;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(margin, compact ? 17 : 23, maxW, maxH, 7);
        ctx.fill();
        ctx.drawImage(logo, margin + (maxW - w) / 2, (compact ? 17 : 23) + (maxH - h) / 2, w, h);
      }
      if (compact) {
        drawText('تقرير زيارة فرع', right, 33, { size: 19, bold: true, color: '#ffffff' });
        meta.forEach((line, index) => drawText(line, right, metaStart + index * metaStep, { size: 10, color: '#f2eae2' }));
        y = Math.max(104, headerHeight + 22);
      } else {
        drawText('ZAM Operations · تقرير رقابة تشغيلية', right, 37, { size: 10, color: '#f2eae2' });
        drawText('تقرير زيارة فرع', right, 69, { size: 23, bold: true, color: '#ffffff' });
        meta.forEach((line, index) => drawText(line, right, metaStart + index * metaStep, { size: 12, color: '#f2eae2' }));
        y = Math.max(141, headerHeight + 21);
      }
    }

    function ensureSpace(height) {
      if (y + height > contentBottom) createPage(true);
    }

    function drawWrapped(value, x, baseline, maxWidth, options = {}) {
      const size = options.size || 10;
      const bold = !!options.bold;
      const lineHeight = options.lineHeight || Math.ceil(size * 1.55);
      const font = `${bold ? '700' : '400'} ${size}px Arial, sans-serif`;
      const lines = wrapLines(value, maxWidth, font, options.direction || 'rtl');
      setText({ ...options, size, bold, align: options.align || 'right' });
      for (const line of lines) {
        current.ctx.fillText(line, x, baseline);
        baseline += lineHeight;
      }
      return { lines, nextY: baseline };
    }

    function drawCardBlocks(blocks) {
      let index = 0;
      while (index < blocks.length) {
        if (y + 54 > contentBottom) createPage(true);
        const top = y;
        const contentTop = top + 18;
        const rows = [];
        let usedHeight = 0;
        while (index < blocks.length) {
          const block = blocks[index];
          if (contentTop + usedHeight + block.step + 10 > contentBottom) break;
          rows.push(block);
          usedHeight += block.step;
          index += 1;
        }
        if (!rows.length) {
          createPage(true);
          continue;
        }
        const height = 18 + usedHeight + 10;
        current.ctx.fillStyle = '#ffffff';
        current.ctx.strokeStyle = '#dfd3c9';
        current.ctx.lineWidth = 1;
        current.ctx.beginPath();
        current.ctx.roundRect(margin, top, pageWidth - margin * 2, height, 8);
        current.ctx.fill();
        current.ctx.stroke();
        let baseline = contentTop;
        for (const row of rows) {
          drawText(row.text, row.x ?? right - 12, baseline, {
            size: row.size || 10,
            bold: !!row.bold,
            color: row.color || ink,
            align: row.align || 'right',
            direction: row.direction || 'rtl'
          });
          if (row.left) drawText(row.left, margin + 12, baseline, {
            size: row.leftSize || row.size || 10,
            bold: !!row.leftBold,
            color: row.leftColor || row.color || ink,
            align: 'left',
            direction: row.leftDirection || 'ltr'
          });
          baseline += row.step;
        }
        y = top + height + 8;
        if (index < blocks.length) createPage(true);
      }
    }

    function drawSection(title) {
      ensureSpace(40);
      current.ctx.fillStyle = brown;
      current.ctx.beginPath();
      current.ctx.roundRect(margin, y, pageWidth - margin * 2, 28, 6);
      current.ctx.fill();
      drawText(title, right - 12, y + 19, { size: 13, bold: true, color: '#ffffff' });
      y += 39;
    }

    function drawSummary() {
      const hasOverride = !!visit.quality_override;
      const gap = 9;
      const cardWidth = (pageWidth - margin * 2 - gap * 3) / 4;
      const reasonLines = hasOverride
        ? wrapLines(`سبب الرسوب الاستثنائي: ${visit.quality_override_reason || '—'}`, cardWidth - 18, '400 9px Arial, sans-serif')
        : [];
      const score = visit.score_percentage == null ? '—' : `${Number(visit.score_percentage).toFixed(0)}%`;
      const cards = [
        { value: quality, label: 'حالة الجودة', reason: visit.quality_override_reason || '', alert: visit.quality_status === 'راسب' },
        { value: visit.visitor_name || '—', label: 'المقيّم' },
        { value: `${visit.score_total ?? '—'} / ${visit.score_possible ?? '—'}`, label: 'الدرجة' },
        { value: score, label: 'النتيجة العامة' }
      ];
      const cardValues = cards.map(card => {
        const size = String(card.value).length > 18 ? 10 : 16;
        return { size, lines: wrapLines(card.value, cardWidth - 16, `${size >= 16 ? '700' : '700'} ${size}px Arial, sans-serif`) };
      });
      const maxValueLines = Math.max(...cardValues.map(item => item.lines.length));
      const labelBaseline = 31 + maxValueLines * 15 + 4;
      const reasonBaseline = labelBaseline + 18;
      const cardHeight = Math.max(96, reasonLines.length ? reasonBaseline + reasonLines.length * 14 + 10 : labelBaseline + 24);
      cards.forEach((card, index) => {
        const x = margin + index * (cardWidth + gap);
        current.ctx.fillStyle = card.alert ? '#fff8ea' : '#f7f3ef';
        current.ctx.strokeStyle = '#eadfd6';
        current.ctx.lineWidth = 1;
        current.ctx.beginPath();
        current.ctx.roundRect(x, y, cardWidth, cardHeight, 8);
        current.ctx.fill();
        current.ctx.stroke();
        cardValues[index].lines.forEach((line, lineIndex) => drawText(line, x + cardWidth / 2, y + 31 + lineIndex * 15, { size: cardValues[index].size, bold: true, color: card.alert ? '#8d332c' : '#76583d', align: 'center' }));
        drawText(card.label, x + cardWidth / 2, y + labelBaseline, { size: 9, color: muted, align: 'center' });
        if (card.reason) {
          reasonLines.forEach((line, lineIndex) => drawText(line, x + cardWidth / 2, y + reasonBaseline + lineIndex * 14, { size: 9, color: '#8d332c', align: 'center' }));
        }
      });
      y += cardHeight + 16;
    }

    function drawCriterion(result) {
      const cardWidth = pageWidth - margin * 2;
      const textWidth = cardWidth - 34;
      const title = result.visit_checklist_templates?.title || '—';
      const category = result.visit_checklist_templates?.category || 'عام';
      const note = result.note ? `ملاحظة: ${result.note}` : '';
      const titleLines = wrapLines(title, textWidth - 72, '700 12px Arial, sans-serif');
      const noteLines = note ? wrapLines(note, textWidth, '400 10px Arial, sans-serif') : [];
      const subchecks = (result.subchecks || []).flatMap(check => wrapLines(`${check.title || check.code || 'نقطة فرعية'} — ${check.score ?? '—'}/10`, textWidth - 8, '400 9px Arial, sans-serif'));
      const resultLines = wrapLines(result.result || '—', textWidth - 8, '400 9px Arial, sans-serif');
      const score = result.score == null ? 'لا ينطبق' : `${result.score}/10`;
      const blocks = [
        { text: category, left: score, size: 9, leftSize: 10, bold: true, leftBold: true, color: '#76583d', step: 16 },
        ...titleLines.map(text => ({ text, size: 12, bold: true, step: 18 })),
        ...resultLines.map(text => ({ text, size: 9, color: '#51402f', step: 14 })),
        ...noteLines.map(text => ({ text, size: 10, step: 15 })),
        ...subchecks.map(text => ({ text: `• ${text}`, size: 9, color: muted, step: 14 }))
      ];
      drawCardBlocks(blocks);
    }

    function drawAction(action) {
      const cardWidth = pageWidth - margin * 2;
      const textWidth = cardWidth - 30;
      const titleLines = wrapLines(action.title || '—', textWidth, '700 12px Arial, sans-serif');
      const body = [
        `الأولوية: ${action.priority || '—'} · المسؤول: ${action.assigned_role || action.profiles?.full_name || '—'}`,
        `الموعد: ${action.due_date || '—'} · الحالة: ${action.status || '—'}`,
        action.description ? `التفاصيل: ${action.description}` : ''
      ].filter(Boolean);
      const bodyLines = body.flatMap(line => wrapLines(line, textWidth, '400 10px Arial, sans-serif'));
      const blocks = [
        { text: action.item_type || 'إجراء', left: action.status || '—', size: 9, bold: true, leftBold: true, color: '#76583d', step: 16, leftDirection: 'rtl' },
        ...titleLines.map(text => ({ text, size: 12, bold: true, step: 18 })),
        ...bodyLines.map(text => ({ text, size: 10, step: 15 }))
      ];
      drawCardBlocks(blocks);
    }

    function drawAttachments() {
      drawSection('المرفقات');
      const supported = attachmentRows.filter(item => item.mime.includes('png') || item.mime.includes('jpeg') || item.mime.includes('jpg') || /\.(png|jpe?g)$/i.test(item.name));
      const lines = attachmentRows.length
        ? attachmentRows.map((item, index) => `${index + 1}. ${item.name || 'مرفق'}${supported.includes(item) ? '' : ' — رابط أو صيغة غير مضمنة كصورة داخل PDF'}`)
        : ['لا توجد مرفقات.'];
      for (const line of lines) {
        const parts = wrapLines(line, pageWidth - margin * 2 - 20, '400 10px Arial, sans-serif');
        for (const part of parts) {
          ensureSpace(22);
          drawText(part, right - 8, y, { size: 10, color: ink });
          y += 16;
        }
        ensureSpace(6);
        y += 6;
      }
      if (supported.length) {
        ensureSpace(25);
        drawText('تُرفق صور الإثبات المتاحة في صفحات الملحق بعد صفحات التقرير.', right, y + 2, { size: 9, color: muted });
        y += 20;
      }
    }

    createPage(false);
    drawSummary();
    drawSection('بنود التقييم ودرجاتها');
    for (const result of (visit.supervisory_visit_results || [])) drawCriterion(result);
    drawSection('الإجراءات والمخالفات');
    const actions = visit.visit_action_items || [];
    if (actions.length) actions.forEach(drawAction);
    else { drawText('لا توجد إجراءات مسجلة.', right, y + 3, { size: 10, color: muted }); y += 24; }
    drawAttachments();
    drawSection('الملاحظات العامة');
    const observation = wrapLines(visit.observation || 'لا توجد ملاحظات عامة.', pageWidth - margin * 2 - 20, '400 10px Arial, sans-serif');
    for (const line of observation) {
      ensureSpace(22);
      drawText(line, right - 8, y, { size: 10 });
      y += 16;
    }

    pages.forEach((page, index) => {
      const ctx = page.ctx;
      ctx.strokeStyle = '#eadfd6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin, 1053);
      ctx.lineTo(pageWidth - margin, 1053);
      ctx.stroke();
      current = page;
      drawText('operation@zam.sa', margin, 1081, { size: 10, color: brown, align: 'left', direction: 'ltr' });
      drawText('اعتماد إلكتروني — محمود شريف — إدارة التشغيل', right, 1081, { size: 10, bold: true, color: brown });
      drawText(`${index + 1} / ${pages.length}`, pageWidth / 2, 1102, { size: 9, color: muted, align: 'center', direction: 'ltr' });
    });

    return pages.map(page => page.canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
  }

  async function requestPdf(visit, options = {}) {
    const rendered_pages = await renderPageImages(visit);
    const { data, error } = await global.zamClient.functions.invoke('visit-report-pdf', {
      body: {
        visit_id: visit.id,
        send_email: options.send_email === true,
        recipient_modes: options.recipient_modes || [],
        rendered_pages
      }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function downloadPdf(visit) {
    const data = await requestPdf(visit);
    if (!data?.signed_url) throw new Error('لم يتم إنشاء رابط تنزيل التقرير.');
    const response = await fetch(data.signed_url);
    if (!response.ok) throw new Error('تعذر تنزيل ملف PDF من التخزين.');
    const blob = await response.blob();
    const url = global.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `visit-${String(visit.visit_date || 'report').replace(/[^0-9-]/g, '-')}.pdf`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
  }

  global.ZamVisitPdf = { buildHtml, renderPageImages, requestPdf, downloadPdf, waitForAssets };
})(window);
