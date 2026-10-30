// ============================================================
// chart_helper.js
//
// PURPOSE: Inject a pie chart into an existing xlsx file's
//          Summary sheet after SheetJS has written it.
//
//          SheetJS (xlsx) community edition cannot create charts,
//          so we use JSZip to manipulate the underlying OOXML zip
//          directly and inject chart XML.
//
//          On repeated runs the existing chart is overwritten
//          (the drawing anchor and relationships are reused).
//
// USAGE:
//   const { injectPieChart } = require('./chart_helper');
//   await injectPieChart(filePath, {
//     sheetName : 'Summary',
//     title     : 'Test Results Breakdown',
//     categories: ['Known Failures', 'Locally Passing', ...],
//     values    : [3, 12, 1, 5, 2],
//     fromCol: 0, fromRow: 8, toCol: 7, toRow: 28,
//   });
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');
const { nm } = require('./utils');

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPieChartXml(title, categories, values) {
  const n      = categories.length;
  const catPts = categories.map((c, i) => `<c:pt idx="${i}"><c:v>${escXml(c)}</c:v></c:pt>`).join('');
  const valPts = values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<c:chartSpace',
    '  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"',
    '  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    '  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '  <c:lang val="en-US"/>',
    '  <c:chart>',
    '    <c:title>',
    '      <c:tx><c:rich><a:bodyPr/><a:lstStyle/>',
    `        <a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>${escXml(title)}</a:t></a:r></a:p>`,
    '      </c:rich></c:tx>',
    '      <c:overlay val="0"/>',
    '    </c:title>',
    '    <c:autoTitleDeleted val="0"/>',
    '    <c:plotArea>',
    '      <c:layout/>',
    '      <c:pieChart>',
    '        <c:varyColors val="1"/>',
    '        <c:ser>',
    '          <c:idx val="0"/>',
    '          <c:order val="0"/>',
    '          <c:dLbls>',
    '            <c:showLegendKey val="0"/>',
    '            <c:showVal val="0"/>',
    '            <c:showCatName val="1"/>',
    '            <c:showSerName val="0"/>',
    '            <c:showPercent val="1"/>',
    '            <c:showBubbleSize val="0"/>',
    '            <c:separator>: </c:separator>',
    '          </c:dLbls>',
    `          <c:cat><c:strLit><c:ptCount val="${n}"/>${catPts}</c:strLit></c:cat>`,
    `          <c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${valPts}</c:numLit></c:val>`,
    '        </c:ser>',
    '        <c:firstSliceAng val="0"/>',
    '      </c:pieChart>',
    '    </c:plotArea>',
    '    <c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>',
    '    <c:plotVisOnly val="1"/>',
    '  </c:chart>',
    '</c:chartSpace>',
  ].join('\n');
}

function buildDrawingXml(chartRelId, fromCol, fromRow, toCol, toRow) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<xdr:wsDr',
    '  xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"',
    '  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    '  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"',
    '  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '  <xdr:twoCellAnchor moveWithCells="1" sizeWithCells="0">',
    '    <xdr:from>',
    `      <xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>`,
    `      <xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>`,
    '    </xdr:from>',
    '    <xdr:to>',
    `      <xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff>`,
    `      <xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>`,
    '    </xdr:to>',
    '    <xdr:graphicFrame macro="">',
    '      <xdr:nvGraphicFramePr>',
    '        <xdr:cNvPr id="2" name="Chart 1"/>',
    '        <xdr:cNvGraphicFramePr/>',
    '      </xdr:nvGraphicFramePr>',
    '      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>',
    '      <a:graphic>',
    '        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">',
    `          <c:chart r:id="${chartRelId}"/>`,
    '        </a:graphicData>',
    '      </a:graphic>',
    '    </xdr:graphicFrame>',
    '    <xdr:clientData/>',
    '  </xdr:twoCellAnchor>',
    '</xdr:wsDr>',
  ].join('\n');
}

function buildRelsXml(rels) {
  const inner = rels.map(r =>
    `  <Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`
  ).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    inner,
    '</Relationships>',
  ].join('\n');
}

// ── Main export ────────────────────────────────────────────
async function injectPieChart(xlsxPath, { sheetName, title, categories, values, fromCol, fromRow, toCol, toRow }) {
  const JSZip = nm('jszip');
  const buf   = fs.readFileSync(xlsxPath);
  const zip   = await JSZip.loadAsync(buf);

  // ── Resolve sheet file from workbook XML ─────────────────
  const wbXml     = await zip.file('xl/workbook.xml').async('string');
  const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');

  const sheetTagMatch = new RegExp(`<sheet\\b[^>]*\\bname="${escXml(sheetName)}"[^>]*\\br:id="([^"]+)"`, 'i').exec(wbXml);
  if (!sheetTagMatch) {
    console.warn(`[chart] Sheet "${sheetName}" not found in workbook.xml — skipping chart`);
    return;
  }
  const sheetRId = sheetTagMatch[1];

  const relTargetMatch = new RegExp(`Id="${sheetRId}"[^>]*Target="([^"]+)"`).exec(wbRelsXml);
  if (!relTargetMatch) {
    console.warn(`[chart] Workbook rel for r:id "${sheetRId}" not found — skipping chart`);
    return;
  }
  const sheetRelTarget = relTargetMatch[1];          // e.g. "worksheets/sheet1.xml"
  const sheetFile      = `xl/${sheetRelTarget}`;     // e.g. "xl/worksheets/sheet1.xml"
  const sheetBase      = path.posix.basename(sheetRelTarget, '.xml'); // "sheet1"
  const sheetRelsPath  = `xl/worksheets/_rels/${sheetBase}.xml.rels`;

  // ── Filter zero values (pie slices with 0 look broken) ───
  const pairs = categories
    .map((c, i) => ({ c, v: values[i] || 0 }))
    .filter(p => p.v > 0);
  if (pairs.length === 0) {
    console.log(`[chart] All values are zero — pie chart skipped for "${sheetName}"`);
    return;
  }
  const filteredCats = pairs.map(p => p.c);
  const filteredVals = pairs.map(p => p.v);

  let sheetXml     = await zip.file(sheetFile).async('string');
  let sheetRelsXml = zip.file(sheetRelsPath)
    ? await zip.file(sheetRelsPath).async('string')
    : '';

  // ── Check if we already inserted a drawing into this sheet ─
  const existingDrawingRef = /<drawing\b[^>]*r:id="([^"]+)"/.exec(sheetXml);

  if (existingDrawingRef) {
    // ── Update mode: overwrite existing chart XML only ──────
    const drawingRelId = existingDrawingRef[1];
    const drawingTargetMatch = new RegExp(`Id="${drawingRelId}"[^>]*Target="([^"]+)"`).exec(sheetRelsXml);
    if (drawingTargetMatch) {
      const drawingTarget = drawingTargetMatch[1];         // "../drawings/drawing1.xml"
      const drawingBase   = path.posix.basename(drawingTarget, '.xml'); // "drawing1"
      const drawingRelsPath = `xl/drawings/_rels/${drawingBase}.xml.rels`;
      if (zip.file(drawingRelsPath)) {
        const drawingRelsXml = await zip.file(drawingRelsPath).async('string');
        const chartTargetMatch = /Target="([^"]*chart[^"]*)"/.exec(drawingRelsXml);
        if (chartTargetMatch) {
          const chartBase = path.posix.basename(chartTargetMatch[1]); // "chart1.xml"
          zip.file(`xl/charts/${chartBase}`, buildPieChartXml(title, filteredCats, filteredVals));
          const outBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
          fs.writeFileSync(xlsxPath, outBuf);
          console.log(`[chart] Updated pie chart "${title}" in "${sheetName}"`);
          return;
        }
      }
    }
    // If we couldn't trace back to the chart file, fall through to add new infrastructure
  }

  // ── Add mode: create chart, drawing, and wiring from scratch ─
  const chartNums = Object.keys(zip.files)
    .filter(f => /^xl\/charts\/chart\d+\.xml$/.test(f))
    .map(f => parseInt(f.match(/chart(\d+)/)[1], 10));
  const chartNum  = chartNums.length ? Math.max(...chartNums) + 1 : 1;

  const drawingNums = Object.keys(zip.files)
    .filter(f => /^xl\/drawings\/drawing\d+\.xml$/.test(f))
    .map(f => parseInt(f.match(/drawing(\d+)/)[1], 10));
  const drawingNum = drawingNums.length ? Math.max(...drawingNums) + 1 : 1;

  const chartFile    = `xl/charts/chart${chartNum}.xml`;
  const drawingFile  = `xl/drawings/drawing${drawingNum}.xml`;
  const drawingRels  = `xl/drawings/_rels/drawing${drawingNum}.xml.rels`;
  const drawingRelId = `rId_d${drawingNum}`;

  // Chart XML
  zip.file(chartFile, buildPieChartXml(title, filteredCats, filteredVals));

  // Drawing XML
  zip.file(drawingFile, buildDrawingXml('rId1', fromCol, fromRow, toCol, toRow));

  // Drawing → Chart relationship
  zip.file(drawingRels, buildRelsXml([{
    id:     'rId1',
    type:   'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
    target: `../charts/chart${chartNum}.xml`,
  }]));

  // Sheet → Drawing relationship
  const drawingRelEntry = `  <Relationship Id="${drawingRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNum}.xml"/>`;
  if (sheetRelsXml) {
    sheetRelsXml = sheetRelsXml.replace('</Relationships>', `${drawingRelEntry}\n</Relationships>`);
  } else {
    sheetRelsXml = buildRelsXml([{
      id:     drawingRelId,
      type:   'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
      target: `../drawings/drawing${drawingNum}.xml`,
    }]);
  }
  zip.file(sheetRelsPath, sheetRelsXml);

  // Ensure xmlns:r is declared on <worksheet> (SheetJS always includes it, but guard anyway)
  if (!sheetXml.includes('xmlns:r=')) {
    sheetXml = sheetXml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  }

  // Inject <drawing> reference before </worksheet>
  sheetXml = sheetXml.replace('</worksheet>', `<drawing r:id="${drawingRelId}"/></worksheet>`);
  zip.file(sheetFile, sheetXml);

  // Content Types
  let ctXml    = await zip.file('[Content_Types].xml').async('string');
  const ctParts = [];
  if (!ctXml.includes(`/xl/charts/chart${chartNum}.xml`)) {
    ctParts.push(`  <Override PartName="/xl/charts/chart${chartNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  }
  if (!ctXml.includes(`/xl/drawings/drawing${drawingNum}.xml`)) {
    ctParts.push(`  <Override PartName="/xl/drawings/drawing${drawingNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  }
  if (ctParts.length) {
    ctXml = ctXml.replace('</Types>', ctParts.join('\n') + '\n</Types>');
    zip.file('[Content_Types].xml', ctXml);
  }

  const outBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(xlsxPath, outBuf);
  console.log(`[chart] Pie chart "${title}" injected into "${sheetName}"`);
}

module.exports = { injectPieChart };
