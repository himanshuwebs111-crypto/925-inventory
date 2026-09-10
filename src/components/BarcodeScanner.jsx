// src/components/BarcodeScanner.jsx

import { useEffect, useRef, useState } from "react";
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";

const SCANNER_ID = "inventory-barcode-reader";

const supportedFormats = [
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
];

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(
    error || "Unable to start the barcode scanner.",
  );
}

async function stopScanner(scanner) {
  if (!scanner) {
    return;
  }

  try {
    if (scanner.isScanning) {
      await scanner.stop();
    }
  } catch {
    // The scanner may already be stopped.
  }

  const scannerElement = document.getElementById(
    SCANNER_ID,
  );

  if (scannerElement) {
    const videos = scannerElement.querySelectorAll("video");

    videos.forEach((video) => {
      const stream = video.srcObject;

      if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
      }

      video.pause();
      video.srcObject = null;
      video.remove();
    });
  }

  try {
    await scanner.clear();
  } catch {
    // Cleanup is best effort.
  }

  if (scannerElement) {
    scannerElement.innerHTML = "";
  }
}

export default function BarcodeScanner({ onScan, onClose }) {
  const scannerRef = useRef(null);
  const mountedRef = useRef(false);
  const hasScannedRef = useRef(false);
  const closingRef = useRef(false);

  const [error, setError] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    hasScannedRef.current = false;
    closingRef.current = false;

    const scannerElement = document.getElementById(
      SCANNER_ID,
    );

    if (scannerElement) {
      scannerElement.innerHTML = "";
    }

    const scanner = new Html5Qrcode(SCANNER_ID);

    scannerRef.current = scanner;

    async function startScanner() {
      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: {
              width: 280,
              height: 160,
            },
            formatsToSupport: supportedFormats,
          },
          async (decodedText) => {
            if (
              !mountedRef.current ||
              hasScannedRef.current ||
              closingRef.current
            ) {
              return;
            }

            const code = decodedText.trim();

            if (!code) {
              return;
            }

            hasScannedRef.current = true;
            closingRef.current = true;

            await stopScanner(scanner);

            if (!mountedRef.current) {
              return;
            }

            onScan(code);
          },
          () => {
            // Scan failures are expected while searching.
          },
        );

        if (
          !mountedRef.current ||
          closingRef.current
        ) {
          await stopScanner(scanner);
          return;
        }
      } catch (scannerError) {
        if (mountedRef.current) {
          setError(getErrorMessage(scannerError));
        } else {
          await stopScanner(scanner);
        }
      }
    }

    startScanner();

    return () => {
      mountedRef.current = false;
      hasScannedRef.current = true;
      closingRef.current = true;

      if (scannerRef.current === scanner) {
        scannerRef.current = null;
      }

      stopScanner(scanner);
    };
  }, [onScan]);

  async function handleClose() {
    if (closingRef.current) {
      return;
    }

    closingRef.current = true;
    hasScannedRef.current = true;

    const scanner = scannerRef.current;

    scannerRef.current = null;

    await stopScanner(scanner);

    onClose();
  }

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  return (
    <div
      className="scanner-modal-backdrop"
      onMouseDown={handleBackdropClick}
    >
      <section
        className="scanner-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scanner-title"
      >
        <div className="scanner-modal-header">
          <div>
            <p className="eyebrow">Inventory</p>

            <h2 id="scanner-title">
              Scan SKU / Barcode
            </h2>

            <p>
              Point your camera at the barcode on the
              jewellery item.
            </p>
          </div>

          <button
            className="close-button"
            type="button"
            aria-label="Close barcode scanner"
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="scanner-error">
            <h3>Scanner could not start</h3>

            <p>{error}</p>
          </div>
        ) : (
          <div
            id={SCANNER_ID}
            className="barcode-reader"
          />
        )}

        <div className="scanner-footer">
          <p>
            Point the camera at a barcode to find the
            jewellery item.
          </p>

          <button
            className="secondary-button"
            type="button"
            onClick={handleClose}
          >
            Close Scanner
          </button>
        </div>
      </section>
    </div>
  );
}