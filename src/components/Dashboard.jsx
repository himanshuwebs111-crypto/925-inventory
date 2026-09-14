// src/components/Dashboard.jsx

import { useMemo } from "react";
import BarcodeScanner from "./BarcodeScanner";

const BASE_CATEGORIES = [
  "Ring",
  "Necklace",
  "Bracelet",
  "Earrings",
  "Pendant",
  "Other",
];

function formatCurrency(value) {
  const numericValue = Number(value) || 0;

  return `₹${numericValue.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatWeight(value) {
  return `${(Number(value) || 0).toFixed(3)} g`;
}

function uniqueCategories(categories) {
  const seen = new Set();

  return categories.filter((category) => {
    const name = String(category ?? "").trim();
    const key = name.toLowerCase();

    if (!name || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export default function Dashboard({
  items,
  categories = BASE_CATEGORIES,
  onOpenInventory,
  onScanSku,
  onBarcodeScan,
  isScannerOpen,
  scannerError,
  scannedItem,
  onCloseScanner,
  onCloseScanResult,
  onEditScannedItem,
  onClearScannerError,
  onLogout,
}) {
  const dashboardCategories = useMemo(
    () =>
      uniqueCategories([
        ...BASE_CATEGORIES,
        ...categories,
        ...items.map((item) =>
          String(item.category ?? "").trim(),
        ),
      ]),
    [categories, items],
  );

  const totals = useMemo(
    () =>
      items.reduce(
        (summary, item) => {
          const quantity = Number(item.quantity) || 0;
          const weight = Number(item.weight) || 0;
          const costPrice = Number(item.costPrice) || 0;
          const sellingPrice =
            Number(item.sellingPrice) || 0;

          return {
            products: summary.products + 1,
            pieces: summary.pieces + quantity,
            weight:
              summary.weight +
              quantity * weight,
            costValue:
              summary.costValue +
              quantity * costPrice,
            sellingValue:
              summary.sellingValue +
              quantity * sellingPrice,
          };
        },
        {
          products: 0,
          pieces: 0,
          weight: 0,
          costValue: 0,
          sellingValue: 0,
        },
      ),
    [items],
  );

  const categoryStats = useMemo(
    () =>
      dashboardCategories.map((category) => {
        const categoryItems = items.filter(
          (item) =>
            String(item.category ?? "")
              .trim()
              .toLowerCase() ===
            category.toLowerCase(),
        );

        const pieces = categoryItems.reduce(
          (total, item) =>
            total + (Number(item.quantity) || 0),
          0,
        );

        const weight = categoryItems.reduce(
          (total, item) =>
            total +
            (Number(item.quantity) || 0) *
              (Number(item.weight) || 0),
          0,
        );

        return {
          category,
          pieces,
          weight,
        };
      }),
    [dashboardCategories, items],
  );

  const maxCategoryPieces = Math.max(
    ...categoryStats.map(
      (category) => category.pieces,
    ),
    1,
  );

  return (
    <main className="app">
      <section className="inventory-card dashboard-card">
        <header className="page-header dashboard-header">
          <div>
            <p className="eyebrow">
              925 Jewellery
            </p>

            <h1>Summary Overview</h1>

            <p className="description">
              Overview of your jewellery
              inventory.
            </p>
          </div>

          <div className="header-actions dashboard-actions">
            <button
              className="secondary-button dashboard-scan-button"
              type="button"
              onClick={onScanSku}
            >
              Scan SKU
            </button>

            <button
              className="primary-button"
              type="button"
              onClick={onOpenInventory}
            >
              Inventory
            </button>

            <button
              className="secondary-button"
              type="button"
              onClick={onLogout}
            >
              Logout
            </button>
          </div>
        </header>

        {scannerError && !isScannerOpen && (
          <div className="dashboard-scan-error">
            <p>{scannerError}</p>

            <button
              className="close-button"
              type="button"
              aria-label="Dismiss scanner error"
              onClick={onClearScannerError}
            >
              ×
            </button>
          </div>
        )}

        <section
          className="dashboard-summary-grid"
          aria-label="Summary overview"
        >
          <article className="dashboard-summary-card">
            <p>Total Products</p>
            <strong>{totals.products}</strong>
          </article>

          <article className="dashboard-summary-card">
            <p>Total Pieces</p>
            <strong>{totals.pieces}</strong>
          </article>

          <article className="dashboard-summary-card">
            <p>Total Weight</p>
            <strong>
              {formatWeight(totals.weight)}
            </strong>
          </article>

          <article className="dashboard-summary-card">
            <p>Stock Cost Value</p>
            <strong>
              {formatCurrency(totals.costValue)}
            </strong>
          </article>

          <article className="dashboard-summary-card">
            <p>Selling Value</p>
            <strong>
              {formatCurrency(
                totals.sellingValue,
              )}
            </strong>
          </article>
        </section>

        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <div>
              <p className="section-label">
                Summary
              </p>

              <h2>Category Overview</h2>
            </div>
          </div>

          <div className="category-dashboard-grid">
            {categoryStats.map((category) => (
              <article
                className="category-dashboard-card"
                key={category.category}
              >
                <div className="category-dashboard-header">
                  <h3>{category.category}</h3>

                  <span>
                    {category.pieces} pieces
                  </span>
                </div>

                <strong>
                  {formatWeight(
                    category.weight,
                  )}
                </strong>

                <p>Total category weight</p>
              </article>
            ))}
          </div>
        </section>

        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <div>
              <p className="section-label">
                Stock distribution
              </p>

              <h2>Pieces by Category</h2>
            </div>
          </div>

          <div className="dashboard-chart">
            {categoryStats.map((category) => {
              const percentage =
                category.pieces === 0
                  ? 0
                  : Math.max(
                      (category.pieces /
                        maxCategoryPieces) *
                        100,
                      4,
                    );

              return (
                <div
                  className="chart-row"
                  key={category.category}
                >
                  <div className="chart-label">
                    <span>
                      {category.category}
                    </span>

                    <strong>
                      {category.pieces}
                    </strong>
                  </div>

                  <div className="chart-track">
                    <div
                      className="chart-bar"
                      style={{
                        width: `${percentage}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="dashboard-footer">
          <div>
            <p className="section-label">
              Manage stock
            </p>

            <h2>
              Need to add or update jewellery?
            </h2>

            <p>
              Open Inventory to add, edit,
              manage categories, or use the
              Excel tools.
            </p>
          </div>

          <button
            className="primary-button"
            type="button"
            onClick={onOpenInventory}
          >
            Open Inventory
          </button>
        </section>

        {isScannerOpen && (
          <BarcodeScanner
            onScan={onBarcodeScan}
            onClose={onCloseScanner}
          />
        )}

        {scannedItem && (
          <div className="scanner-result-backdrop">
            <section
              className="scanner-result"
              role="dialog"
              aria-modal="true"
              aria-labelledby="scanner-result-title"
            >
              <div className="scanner-result-header">
                <div>
                  <p className="eyebrow">
                    Barcode Found
                  </p>

                  <h2 id="scanner-result-title">
                    {scannedItem.name}
                  </h2>
                </div>

                <button
                  className="close-button"
                  type="button"
                  aria-label="Close scan result"
                  onClick={onCloseScanResult}
                >
                  ×
                </button>
              </div>

              {scannedItem.imageUrl && (
                <div className="scanner-result-image">
                  <img
                    src={scannedItem.imageUrl}
                    alt={`${scannedItem.name} product`}
                  />
                </div>
              )}

              <dl className="scanner-result-details">
                <div>
                  <dt>SKU</dt>
                  <dd>
                    {scannedItem.sku || "—"}
                  </dd>
                </div>

                <div>
                  <dt>Category</dt>
                  <dd>{scannedItem.category}</dd>
                </div>

                <div>
                  <dt>Material</dt>
                  <dd>{scannedItem.material}</dd>
                </div>

                <div>
                  <dt>Quantity</dt>
                  <dd>{scannedItem.quantity}</dd>
                </div>

                <div>
                  <dt>Weight</dt>
                  <dd>
                    {formatWeight(
                      scannedItem.weight,
                    )}
                  </dd>
                </div>

                <div>
                  <dt>Cost</dt>
                  <dd>
                    {scannedItem.costPrice !==
                      null &&
                    scannedItem.costPrice !==
                      undefined &&
                    scannedItem.costPrice !==
                      ""
                      ? formatCurrency(
                          Number(
                            scannedItem.costPrice,
                          ),
                        )
                      : "—"}
                  </dd>
                </div>

                <div>
                  <dt>Selling price</dt>
                  <dd>
                    {scannedItem.sellingPrice !==
                      null &&
                    scannedItem.sellingPrice !==
                      undefined &&
                    scannedItem.sellingPrice !==
                      ""
                      ? formatCurrency(
                          Number(
                            scannedItem.sellingPrice,
                          ),
                        )
                      : "—"}
                  </dd>
                </div>

                {scannedItem.notes && (
                  <div>
                    <dt>Notes</dt>
                    <dd>{scannedItem.notes}</dd>
                  </div>
                )}
              </dl>

              <div className="scanner-result-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onCloseScanResult}
                >
                  Close
                </button>

                <button
                  className="primary-button"
                  type="button"
                  onClick={onEditScannedItem}
                >
                  Edit Item
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
