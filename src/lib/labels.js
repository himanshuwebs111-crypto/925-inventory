// src/lib/labels.js

import JsBarcode from "jsbarcode";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createBarcodeSvg(item) {
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );

  JsBarcode(svg, item.sku || "NO-SKU", {
    format: "CODE128",
    width: 2,
    height: 70,
    displayValue: true,
    fontSize: 16,
    margin: 0,
  });

  return new XMLSerializer().serializeToString(svg);
}

export function createBarcodePng(item) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");

    JsBarcode(canvas, item.sku || "NO-SKU", {
      format: "CODE128",
      width: 3,
      height: 100,
      displayValue: true,
      fontSize: 22,
      margin: 10,
    });

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not create barcode image."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}

export function createLabelPng(item) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      reject(new Error("Could not create label canvas."));
      return;
    }

    canvas.width = 700;
    canvas.height = 620;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "#252525";
    context.textAlign = "center";

    context.font = "bold 28px Arial";
    context.fillText("925 JEWELLERY", 350, 45);

    context.font = "bold 30px Arial";
    context.fillText(
      String(item.name || "Unnamed Item").slice(0, 30),
      350,
      90,
    );

    context.font = "22px Arial";
    context.fillText(
      `Category: ${item.category || "Other"}`,
      350,
      125,
    );

    const weightText =
      item.weight !== "" &&
      item.weight !== null &&
      item.weight !== undefined
        ? `Weight: ${item.weight} g`
        : "Weight: —";

    context.fillText(weightText, 350, 160);

    const barcodeCanvas = document.createElement("canvas");

    JsBarcode(barcodeCanvas, item.sku || "NO-SKU", {
      format: "CODE128",
      width: 3,
      height: 100,
      displayValue: true,
      fontSize: 22,
      margin: 10,
    });

    const barcodeX =
      (canvas.width - barcodeCanvas.width) / 2;

    context.drawImage(
      barcodeCanvas,
      barcodeX,
      185,
    );

    context.font = "bold 24px Arial";
    context.fillText(
      `SKU: ${item.sku || "NO-SKU"}`,
      350,
      330,
    );

    context.font = "20px Arial";
    context.fillText("925 Silver", 350, 365);

    context.strokeStyle = "#252525";
    context.lineWidth = 2;
    context.strokeRect(15, 15, 670, 590);

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not create label image."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export function downloadTextFile(text, filename, mimeType) {
  const blob = new Blob([text], {
    type: mimeType,
  });

  downloadBlob(blob, filename);
}

export function createPrintLabelHtml(item) {
  const weightText =
    item.weight !== "" &&
    item.weight !== null &&
    item.weight !== undefined
      ? `${escapeHtml(item.weight)} g`
      : "—";

  const barcodeSvg = createBarcodeSvg(item);

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(item.name)} - Label</title>
        <style>
          @page {
            size: 70mm 45mm;
            margin: 0;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
            background: white;
          }

          .label {
            width: 70mm;
            height: 45mm;
            padding: 3mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            text-align: center;
            overflow: hidden;
          }

          .brand {
            font-size: 4mm;
            font-weight: bold;
            margin-bottom: 1mm;
          }

          .name {
            font-size: 4mm;
            font-weight: bold;
            max-width: 64mm;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .details {
            font-size: 3mm;
            margin-top: 1mm;
          }

          .barcode {
            width: 62mm;
            height: 14mm;
            margin-top: 1mm;
          }

          .sku {
            font-size: 3mm;
            font-weight: bold;
            margin-top: 0.5mm;
          }

          .silver {
            font-size: 2.8mm;
            margin-top: 0.5mm;
          }

          svg {
            max-width: 62mm;
            height: 14mm;
          }
        </style>
      </head>

      <body>
        <div class="label">
          <div class="brand">925 JEWELLERY</div>

          <div class="name">
            ${escapeHtml(item.name || "Unnamed Item")}
          </div>

          <div class="details">
            ${escapeHtml(item.category || "Other")}
            · Weight: ${weightText}
          </div>

          <div class="barcode">
            ${barcodeSvg}
          </div>

          <div class="sku">
            SKU: ${escapeHtml(item.sku || "NO-SKU")}
          </div>

          <div class="silver">
            925 Silver
          </div>
        </div>
      </body>
    </html>
  `;
}

export function printLabel(item) {
  const printWindow = window.open(
    "",
    "_blank",
    "width=500,height=500",
  );

  if (!printWindow) {
    throw new Error(
      "The print window was blocked. Please allow pop-ups for this site.",
    );
  }

  printWindow.document.open();
  printWindow.document.write(createPrintLabelHtml(item));
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
}