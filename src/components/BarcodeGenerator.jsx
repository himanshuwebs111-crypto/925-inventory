// src/components/BarcodeGenerator.jsx

import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";

function getSafeFileName(value) {
  return (
    String(value || "barcode")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "barcode"
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function drawCenteredText(
  context,
  text,
  x,
  y,
  font,
) {
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#252525";
  context.fillText(text, x, y);
}

function createBarcodeSvg(item) {
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );

  JsBarcode(svg, item.sku, {
    format: "CODE128",
    width: 2,
    height: 80,
    displayValue: true,
    text: item.sku,
    fontSize: 16,
    font: "Arial",
    textMargin: 6,
    margin: 10,
    background: "#ffffff",
    lineColor: "#252525",
  });

  svg.setAttribute(
    "xmlns",
    "http://www.w3.org/2000/svg",
  );

  return new XMLSerializer().serializeToString(svg);
}

function downloadSvgFile(svgElement, sku) {
  const svgClone = svgElement.cloneNode(true);

  svgClone.setAttribute(
    "xmlns",
    "http://www.w3.org/2000/svg",
  );

  const svgData =
    new XMLSerializer().serializeToString(
      svgClone,
    );

  const blob = new Blob([svgData], {
    type: "image/svg+xml;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${getSafeFileName(
    sku,
  )}-barcode.svg`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function svgToImage(svgData) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgData], {
      type: "image/svg+xml;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error("Unable to create barcode image."),
      );
    };

    image.src = url;
  });
}

async function createLabelPng(item) {
  const barcodeSvg = createBarcodeSvg(item);
  const image = await svgToImage(barcodeSvg);

  const scale = 3;
  const labelWidth = 700;
  const labelHeight = 620;

  const canvas =
    document.createElement("canvas");

  canvas.width = labelWidth * scale;
  canvas.height = labelHeight * scale;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "Unable to create label image.",
    );
  }

  context.scale(scale, scale);

  context.fillStyle = "#ffffff";
  context.fillRect(
    0,
    0,
    labelWidth,
    labelHeight,
  );

  context.strokeStyle = "#e3ded8";
  context.lineWidth = 2;

  context.strokeRect(
    1,
    1,
    labelWidth - 2,
    labelHeight - 2,
  );

  drawCenteredText(
    context,
    "925 JEWELLERY",
    labelWidth / 2,
    55,
    "700 22px Arial",
  );

  drawCenteredText(
    context,
    item.name || "Jewellery Item",
    labelWidth / 2,
    105,
    "700 32px Arial",
  );

  drawCenteredText(
    context,
    `Category: ${item.category || "Other"}`,
    labelWidth / 2,
    150,
    "500 21px Arial",
  );

  const weight = item.weight
    ? `${Number(item.weight).toFixed(3)} g`
    : "—";

  drawCenteredText(
    context,
    `Weight: ${weight}`,
    labelWidth / 2,
    190,
    "600 21px Arial",
  );

  const barcodeWidth =
    image.width / scale;

  const barcodeHeight =
    image.height / scale;

  const barcodeX =
    (labelWidth - barcodeWidth) / 2;

  context.drawImage(
    image,
    barcodeX,
    230,
    barcodeWidth,
    barcodeHeight,
  );

  drawCenteredText(
    context,
    `SKU: ${item.sku}`,
    labelWidth / 2,
    510,
    "700 24px Arial",
  );

  context.fillStyle = "#8a6d46";

  context.fillRect(
    60,
    550,
    labelWidth - 120,
    2,
  );

  drawCenteredText(
    context,
    "925 Silver",
    labelWidth / 2,
    580,
    "500 18px Arial",
  );

  return canvas.toDataURL("image/png");
}

function downloadDataUrl(dataUrl, fileName) {
  const link = document.createElement("a");

  link.href = dataUrl;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function BarcodeGenerator({
  item,
  onClose,
}) {
  const barcodeRef = useRef(null);
  const [error, setError] = useState("");
  const [isDownloading, setIsDownloading] =
    useState(false);

  useEffect(() => {
    if (!barcodeRef.current) {
      return;
    }

    barcodeRef.current.innerHTML = "";
    setError("");

    const sku = String(item?.sku ?? "").trim();

    if (!sku) {
      setError(
        "This item does not have an SKU. Add an SKU before generating a barcode.",
      );
      return;
    }

    try {
      JsBarcode(barcodeRef.current, sku, {
        format: "CODE128",
        width: 2,
        height: 110,
        displayValue: true,
        text: sku,
        fontSize: 18,
        font: "Arial",
        textMargin: 8,
        margin: 20,
        background: "#ffffff",
        lineColor: "#252525",
      });
    } catch (barcodeError) {
      setError(
        barcodeError?.message ||
          "Unable to generate the barcode.",
      );
    }
  }, [item]);

  useEffect(() => {
    if (!item) {
      return undefined;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.body.style.overflow =
        previousOverflow;

      document.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [item, onClose]);

  function downloadBarcode() {
    if (!barcodeRef.current || !item?.sku) {
      return;
    }

    downloadSvgFile(
      barcodeRef.current,
      item.sku,
    );
  }

  async function downloadLabel() {
    if (!item?.sku || isDownloading) {
      return;
    }

    setIsDownloading(true);
    setError("");

    try {
      const dataUrl = await createLabelPng(item);

      downloadDataUrl(
        dataUrl,
        `${getSafeFileName(
          item.sku,
        )}-label.png`,
      );
    } catch (downloadError) {
      setError(
        downloadError?.message ||
          "Unable to download the label.",
      );
    } finally {
      setIsDownloading(false);
    }
  }

  function printLabel() {
    if (!item?.sku) {
      return;
    }

    try {
      const barcodeSvg = createBarcodeSvg(item);

      const weight = item.weight
        ? `${Number(item.weight).toFixed(3)} g`
        : "—";

      const productName =
        String(item.name || "Jewellery Item");

      const category =
        String(item.category || "Other");

      const sku = String(item.sku);

      const printWindow = window.open(
        "",
        "_blank",
        "width=700,height=600",
      );

      if (!printWindow) {
        setError(
          "The print window was blocked. Please allow pop-ups for this app and try again.",
        );
        return;
      }

      const printDocument = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>
              ${escapeHtml(productName)} - ${escapeHtml(sku)}
            </title>

            <style>
              @page {
                size: 70mm 45mm;
                margin: 0;
              }

              * {
                box-sizing: border-box;
              }

              html,
              body {
                margin: 0;
                padding: 0;
                width: 70mm;
                height: 45mm;
                background: #ffffff;
              }

              body {
                font-family:
                  Arial,
                  Helvetica,
                  sans-serif;
              }

              .label {
                width: 70mm;
                height: 45mm;
                padding: 3mm;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                background: #ffffff;
                color: #252525;
              }

              .brand {
                margin-bottom: 1.5mm;
                font-size: 7pt;
                font-weight: 700;
                letter-spacing: 1.4px;
              }

              .product {
                max-width: 62mm;
                margin-bottom: 1mm;
                overflow: hidden;
                font-size: 12pt;
                font-weight: 700;
                text-align: center;
                text-overflow: ellipsis;
                white-space: nowrap;
              }

              .details {
                display: flex;
                gap: 3mm;
                margin-bottom: 1.5mm;
                font-size: 7.5pt;
                font-weight: 600;
              }

              .detail {
                white-space: nowrap;
              }

              .barcode {
                width: 58mm;
                height: auto;
                max-height: 15mm;
                display: block;
              }

              .sku {
                margin-top: 0.5mm;
                font-size: 8pt;
                font-weight: 700;
              }
            </style>
          </head>

          <body>
            <div class="label">
              <div class="brand">
                925 JEWELLERY
              </div>

              <div class="product">
                ${escapeHtml(productName)}
              </div>

              <div class="details">
                <span class="detail">
                  ${escapeHtml(category)}
                </span>

                <span class="detail">
                  ${escapeHtml(weight)}
                </span>
              </div>

              <div class="barcode">
                ${barcodeSvg}
              </div>

              <div class="sku">
                SKU: ${escapeHtml(sku)}
              </div>
            </div>

            <script>
              window.onload = function () {
                window.focus();
                window.print();
              };

              window.onafterprint = function () {
                window.close();
              };
            </script>
          </body>
        </html>
      `;

      printWindow.document.open();
      printWindow.document.write(printDocument);
      printWindow.document.close();
    } catch (printError) {
      setError(
        printError?.message ||
          "Unable to prepare the label for printing.",
      );
    }
  }

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  if (!item) {
    return null;
  }

  const backdropStyle = {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 999999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    boxSizing: "border-box",
    backgroundColor:
      "rgba(20, 18, 16, 0.72)",
    backdropFilter: "blur(4px)",
  };

  const modalStyle = {
    position: "relative",
    width: "min(620px, 100%)",
    maxHeight: "calc(100vh - 48px)",
    overflowY: "auto",
    boxSizing: "border-box",
    padding: "30px",
    backgroundColor: "#ffffff",
    border: "1px solid #e3ded8",
    borderRadius: "22px",
    boxShadow:
      "0 30px 90px rgba(0, 0, 0, 0.28)",
  };

  const content = (
    <div
      style={backdropStyle}
      onMouseDown={handleBackdropClick}
    >
      <section
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-generator-title"
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "20px",
            marginBottom: "22px",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 6px",
                color: "#8a6d46",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.12em",
              }}
            >
              925 JEWELLERY
            </p>

            <h2
              id="barcode-generator-title"
              style={{
                margin: "0 0 8px",
                color: "#252525",
                fontSize: "28px",
              }}
            >
              Product Label
            </h2>

            <p
              style={{
                margin: 0,
                color: "#6d6a66",
              }}
            >
              Barcode and product information.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close barcode popup"
            style={{
              width: "40px",
              height: "40px",
              border: "none",
              borderRadius: "10px",
              backgroundColor: "#f3f1ee",
              fontSize: "28px",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(3, minmax(0, 1fr))",
            gap: "10px",
            marginBottom: "18px",
          }}
        >
          <div
            style={{
              padding: "14px",
              border: "1px solid #e3ded8",
              borderRadius: "12px",
              backgroundColor: "#f9f7f4",
            }}
          >
            <span
              style={{
                display: "block",
                marginBottom: "5px",
                color: "#8a6d46",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              PRODUCT
            </span>

            <strong>{item.name}</strong>
          </div>

          <div
            style={{
              padding: "14px",
              border: "1px solid #e3ded8",
              borderRadius: "12px",
              backgroundColor: "#f9f7f4",
            }}
          >
            <span
              style={{
                display: "block",
                marginBottom: "5px",
                color: "#8a6d46",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              CATEGORY
            </span>

            <strong>{item.category}</strong>
          </div>

          <div
            style={{
              padding: "14px",
              border: "1px solid #e3ded8",
              borderRadius: "12px",
              backgroundColor: "#f9f7f4",
            }}
          >
            <span
              style={{
                display: "block",
                marginBottom: "5px",
                color: "#8a6d46",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              WEIGHT
            </span>

            <strong>
              {item.weight
                ? `${Number(item.weight).toFixed(3)} g`
                : "—"}
            </strong>
          </div>
        </div>

        {error ? (
          <div
            style={{
              padding: "20px",
              borderRadius: "14px",
              backgroundColor: "#fff8f6",
              color: "#8b3d32",
            }}
          >
            <h3>Barcode unavailable</h3>
            <p>{error}</p>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: "220px",
              padding: "28px 20px",
              border: "1px solid #e3ded8",
              borderRadius: "16px",
              backgroundColor: "#ffffff",
              overflowX: "auto",
            }}
          >
            <svg
              ref={barcodeRef}
              role="img"
              aria-label={`Barcode for ${item.sku}`}
              style={{
                display: "block",
                width: "auto",
                maxWidth: "100%",
                height: "auto",
              }}
            />
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "24px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: "46px",
              padding: "0 18px",
              border: "1px solid #e3ded8",
              borderRadius: "10px",
              backgroundColor: "#f3f1ee",
              color: "#252525",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>

          {!error && (
            <>
              <button
                type="button"
                onClick={downloadBarcode}
                style={{
                  minHeight: "46px",
                  padding: "0 18px",
                  border: "1px solid #e3ded8",
                  borderRadius: "10px",
                  backgroundColor: "#ffffff",
                  color: "#252525",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Download Barcode
              </button>

              <button
                type="button"
                onClick={downloadLabel}
                disabled={isDownloading}
                style={{
                  minHeight: "46px",
                  padding: "0 18px",
                  border: "1px solid #e3ded8",
                  borderRadius: "10px",
                  backgroundColor: "#f3f1ee",
                  color: "#252525",
                  fontWeight: 600,
                  cursor: isDownloading
                    ? "wait"
                    : "pointer",
                }}
              >
                {isDownloading
                  ? "Creating..."
                  : "Download Label"}
              </button>

              <button
                type="button"
                onClick={printLabel}
                style={{
                  minHeight: "46px",
                  padding: "0 18px",
                  border: "1px solid #252525",
                  borderRadius: "10px",
                  backgroundColor: "#252525",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Print Label
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );

  return createPortal(content, document.body);
}