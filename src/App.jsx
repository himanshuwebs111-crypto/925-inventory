// src/App.jsx

import JSZip from "jszip";
import JsBarcode from "jsbarcode";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import "./App.css";
import BarcodeScanner from "./components/BarcodeScanner";
import BarcodeGenerator from "./components/BarcodeGenerator";
import {
  createInventoryItem,
  createInventoryItems,
  deleteInventoryItem,
  fetchInventoryItems,
  updateInventoryItem,
} from "./lib/inventory";

const STORAGE_KEY = "925-jewellery-inventory";
const MIGRATION_KEY = "925-jewellery-supabase-migrated";

const emptyForm = {
  name: "",
  sku: "",
  category: "Ring",
  material: "925 Silver",
  quantity: "1",
  weight: "",
  costPrice: "",
  sellingPrice: "",
  notes: "",
};

const categories = [
  "Ring",
  "Necklace",
  "Bracelet",
  "Earrings",
  "Pendant",
  "Other",
];

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function levenshteinDistance(first, second) {
  const a = normalizeText(first);
  const b = normalizeText(second);

  if (a === b) {
    return 0;
  }

  if (a.length === 0) {
    return b.length;
  }

  if (b.length === 0) {
    return a.length;
  }

  let previousRow = Array.from(
    { length: b.length + 1 },
    (_, index) => index,
  );

  for (let i = 1; i <= a.length; i += 1) {
    const currentRow = [i];

    for (let j = 1; j <= b.length; j += 1) {
      const insertionCost = currentRow[j - 1] + 1;
      const deletionCost = previousRow[j] + 1;
      const replacementCost =
        previousRow[j - 1] +
        (a[i - 1] === b[j - 1] ? 0 : 1);

      currentRow.push(
        Math.min(
          insertionCost,
          deletionCost,
          replacementCost,
        ),
      );
    }

    previousRow = currentRow;
  }

  return previousRow[b.length];
}

function getAllowedTypoDistance(word) {
  if (word.length <= 3) {
    return 0;
  }

  if (word.length <= 6) {
    return 1;
  }

  return 2;
}

function wordMatchesSearch(searchWord, inventoryWord) {
  const search = normalizeText(searchWord);
  const inventory = normalizeText(inventoryWord);

  if (!search || !inventory) {
    return false;
  }

  if (
    inventory.includes(search) ||
    search.includes(inventory)
  ) {
    return true;
  }

  const allowedDistance = getAllowedTypoDistance(search);

  if (allowedDistance === 0) {
    return false;
  }

  if (
    Math.abs(search.length - inventory.length) >
    allowedDistance
  ) {
    return false;
  }

  return (
    levenshteinDistance(search, inventory) <=
    allowedDistance
  );
}

function itemMatchesSearch(item, searchTerm) {
  const search = normalizeText(searchTerm);

  if (!search) {
    return true;
  }

  const searchableFields = [
    item.name,
    item.sku,
    item.category,
    item.material,
    item.notes,
  ];

  const searchableWords = searchableFields
    .flatMap((field) =>
      normalizeText(field)
        .split(/[\s\-_/.,]+/)
        .filter(Boolean),
    );

  const searchWords = search
    .split(/[\s\-_/.,]+/)
    .filter(Boolean);

  return searchWords.every((searchWord) =>
    searchableWords.some((inventoryWord) =>
      wordMatchesSearch(searchWord, inventoryWord),
    ),
  );
}

function readLocalItems() {
  try {
    const savedItems = localStorage.getItem(STORAGE_KEY);

    if (!savedItems) {
      return [];
    }

    const parsedItems = JSON.parse(savedItems);

    if (!Array.isArray(parsedItems)) {
      return [];
    }

    return parsedItems;
  } catch {
    return [];
  }
}

function getFormFromItem(item) {
  return {
    name: String(item.name ?? ""),
    sku: String(item.sku ?? ""),
    category: String(item.category ?? "Ring"),
    material: String(item.material ?? "925 Silver"),
    quantity: String(item.quantity ?? 1),
    weight: String(item.weight ?? ""),
    costPrice: String(item.costPrice ?? ""),
    sellingPrice: String(item.sellingPrice ?? ""),
    notes: String(item.notes ?? ""),
  };
}

function getErrorMessage(error) {
  return error?.message || "Something went wrong.";
}

function getSafeFileName(value) {
  return (
    String(value || "label")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "label"
  );
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

function createLabelPng(item) {
  return new Promise((resolve, reject) => {
    const sku = String(item?.sku ?? "").trim();

    if (!sku) {
      reject(
        new Error(
          `Item "${item?.name || "Unknown item"}" does not have an SKU.`,
        ),
      );
      return;
    }

    try {
      const barcodeCanvas =
        document.createElement("canvas");

      JsBarcode(barcodeCanvas, sku, {
        format: "CODE128",
        width: 4,
        height: 110,
        displayValue: true,
        text: sku,
        fontSize: 20,
        font: "Arial",
        textMargin: 8,
        margin: 10,
        background: "#ffffff",
        lineColor: "#252525",
      });

      const scale = 3;

      const labelWidth = 700;
      const labelHeight = 450;

      const canvas =
        document.createElement("canvas");

      canvas.width = labelWidth * scale;
      canvas.height = labelHeight * scale;

      const context = canvas.getContext("2d");

      if (!context) {
        reject(
          new Error(
            "Unable to create label image.",
          ),
        );
        return;
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
        32,
        "700 20px Arial",
      );

      drawCenteredText(
        context,
        item.name || "Jewellery Item",
        labelWidth / 2,
        68,
        "700 28px Arial",
      );

      const category =
        item.category || "Other";

      const weight =
        item.weight !== "" &&
        item.weight !== null &&
        item.weight !== undefined
          ? `${Number(item.weight).toFixed(3)} g`
          : "—";

      drawCenteredText(
        context,
        `Category: ${category}    •    Weight: ${weight}`,
        labelWidth / 2,
        100,
        "600 17px Arial",
      );

      const targetBarcodeWidth = 560;
      const targetBarcodeHeight = 125;

      const barcodeX =
        (labelWidth -
          targetBarcodeWidth) /
        2;

      context.drawImage(
        barcodeCanvas,
        barcodeX,
        120,
        targetBarcodeWidth,
        targetBarcodeHeight,
      );

      drawCenteredText(
        context,
        `SKU: ${sku}`,
        labelWidth / 2,
        270,
        "700 22px Arial",
      );

      context.fillStyle = "#8a6d46";

      context.fillRect(
        60,
        300,
        labelWidth - 120,
        2,
      );

      drawCenteredText(
        context,
        "925 Silver",
        labelWidth / 2,
        330,
        "600 17px Arial",
      );

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(
              new Error(
                "Unable to create label image.",
              ),
            );
            return;
          }

          resolve(blob);
        },
        "image/png",
      );
    } catch (labelError) {
      reject(labelError);
    }
  });
}


function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function App() {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedItem, setScannedItem] = useState(null);
  const [barcodeItem, setBarcodeItem] = useState(null);

  const [isLabelSelectionMode, setIsLabelSelectionMode] =
    useState(false);

  const [selectedLabelIds, setSelectedLabelIds] =
    useState([]);

  const [isDownloadingLabels, setIsDownloadingLabels] =
    useState(false);

  const isEditing = editingItemId !== null;

  useEffect(() => {
    let cancelled = false;

    async function loadInventory() {
      setIsLoading(true);
      setError("");

      try {
        let databaseItems = await fetchInventoryItems();

        const migrationCompleted =
          localStorage.getItem(MIGRATION_KEY) === "true";

        if (
          !migrationCompleted &&
          databaseItems.length === 0
        ) {
          const localItems = readLocalItems();

          if (localItems.length > 0) {
            await createInventoryItems(localItems);
            databaseItems =
              await fetchInventoryItems();
          }

          localStorage.setItem(
            MIGRATION_KEY,
            "true",
          );
        }

        if (!cancelled) {
          setItems(databaseItems);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadInventory();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory =
        categoryFilter === "All" ||
        String(item.category ?? "") ===
          categoryFilter;

      if (!matchesCategory) {
        return false;
      }

      return itemMatchesSearch(
        item,
        searchTerm,
      );
    });
  }, [
    items,
    searchTerm,
    categoryFilter,
  ]);

  const totals = useMemo(() => {
    return items.reduce(
      (summary, item) => {
        const quantity =
          Number(item.quantity) || 0;

        const costPrice =
          Number(item.costPrice) || 0;

        const sellingPrice =
          Number(item.sellingPrice) || 0;

        return {
          quantity:
            summary.quantity + quantity,

          costValue:
            summary.costValue +
            quantity * costPrice,

          sellingValue:
            summary.sellingValue +
            quantity * sellingPrice,
        };
      },
      {
        quantity: 0,
        costValue: 0,
        sellingValue: 0,
      },
    );
  }, [items]);

  function openAddForm() {
    setForm(emptyForm);
    setEditingItemId(null);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(item) {
    setForm(getFormFromItem(item));
    setEditingItemId(item.id);
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    if (isSaving) {
      return;
    }

    setIsFormOpen(false);
    setEditingItemId(null);
    setForm(emptyForm);
    setError("");
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));

    setError("");
  }

  function validateForm() {
    const name = form.name.trim();
    const quantity = Number(form.quantity);

    if (!name) {
      return "Please enter an item name.";
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      return "Quantity must be a whole number greater than 0.";
    }

    if (
      form.costPrice &&
      Number.isNaN(Number(form.costPrice))
    ) {
      return "Please enter a valid cost price.";
    }

    if (
      form.costPrice &&
      Number(form.costPrice) < 0
    ) {
      return "Cost price cannot be negative.";
    }

    if (
      form.sellingPrice &&
      Number.isNaN(
        Number(form.sellingPrice),
      )
    ) {
      return "Please enter a valid selling price.";
    }

    if (
      form.sellingPrice &&
      Number(form.sellingPrice) < 0
    ) {
      return "Selling price cannot be negative.";
    }

    if (
      form.weight &&
      Number.isNaN(Number(form.weight))
    ) {
      return "Please enter a valid weight.";
    }

    if (
      form.weight &&
      Number(form.weight) < 0
    ) {
      return "Weight cannot be negative.";
    }

    return "";
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationError =
      validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      if (isEditing) {
        const updatedItem =
          await updateInventoryItem(
            editingItemId,
            form,
          );

        setItems((currentItems) =>
          currentItems.map((item) =>
            item.id === editingItemId
              ? updatedItem
              : item,
          ),
        );

        setScannedItem((currentItem) =>
          currentItem?.id === editingItemId
            ? updatedItem
            : currentItem,
        );
      } else {
        const newItem =
          await createInventoryItem(form);

        setItems((currentItems) => [
          newItem,
          ...currentItems,
        ]);
      }

      setIsFormOpen(false);
      setEditingItemId(null);
      setForm(emptyForm);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(item) {
    const shouldDelete = window.confirm(
      `Delete "${item.name}" from your inventory?`,
    );

    if (!shouldDelete) {
      return;
    }

    setError("");

    try {
      await deleteInventoryItem(item.id);

      setItems((currentItems) =>
        currentItems.filter(
          (currentItem) =>
            currentItem.id !== item.id,
        ),
      );

      setSelectedLabelIds(
        (currentIds) =>
          currentIds.filter(
            (id) => id !== item.id,
          ),
      );

      if (scannedItem?.id === item.id) {
        setScannedItem(null);
      }
    } catch (deleteError) {
      setError(
        getErrorMessage(deleteError),
      );
    }
  }

  function clearFilters() {
    setSearchTerm("");
    setCategoryFilter("All");
  }

  function formatCurrency(value) {
    return `₹${value.toLocaleString(
      "en-IN",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    )}`;
  }

  function openScanner() {
    setError("");
    setScannedItem(null);
    setIsScannerOpen(true);
  }

  function closeScanner() {
    setIsScannerOpen(false);
  }

  function openBarcode(item) {
    setError("");
    setBarcodeItem(item);
  }

  function closeBarcode() {
    setBarcodeItem(null);
  }

  function toggleLabelSelection(itemId) {
    setSelectedLabelIds((currentIds) => {
      if (currentIds.includes(itemId)) {
        return currentIds.filter(
          (id) => id !== itemId,
        );
      }

      return [...currentIds, itemId];
    });
  }

  function selectAllLabels() {
    setSelectedLabelIds(
      filteredItems.map((item) => item.id),
    );
  }

  function clearLabelSelection() {
    setSelectedLabelIds([]);
  }

  function closeLabelSelectionMode() {
    setIsLabelSelectionMode(false);
    setSelectedLabelIds([]);
  }

  async function downloadSelectedLabels() {
    const selectedItems =
      filteredItems.filter((item) =>
        selectedLabelIds.includes(item.id),
      );

    if (selectedItems.length === 0) {
      setError(
        "Please select at least one item.",
      );
      return;
    }

    const itemsWithoutSku =
      selectedItems.filter(
        (item) =>
          !String(item.sku ?? "").trim(),
      );

    if (itemsWithoutSku.length > 0) {
      const names =
        itemsWithoutSku
          .map(
            (item) =>
              item.name || "Unnamed item",
          )
          .join(", ");

      setError(
        `These items need an SKU before labels can be created: ${names}`,
      );

      return;
    }

    setIsDownloadingLabels(true);
    setError("");

    try {
      const zip = new JSZip();

      for (const item of selectedItems) {
        const labelBlob =
          await createLabelPng(item);

        zip.file(
          `${getSafeFileName(
            item.sku,
          )}-label.png`,
          labelBlob,
        );
      }

      const zipBlob =
        await zip.generateAsync({
          type: "blob",
        });

      downloadBlob(
        zipBlob,
        "925-jewellery-labels.zip",
      );

      closeLabelSelectionMode();
    } catch (downloadError) {
      console.error(downloadError);

      setError(
        downloadError?.message ||
          "Could not create the label download.",
      );
    } finally {
      setIsDownloadingLabels(false);
    }
  }

  const handleBarcodeScan = useCallback(
    (scannedCode) => {
      const normalizedCode =
        normalizeText(scannedCode);

      if (!normalizedCode) {
        setError(
          "The scanner returned an empty barcode.",
        );
        return;
      }

      const matchedItem = items.find(
        (item) =>
          normalizeText(item.sku) ===
          normalizedCode,
      );

      if (!matchedItem) {
        setError(
          `No inventory item was found for SKU "${scannedCode}".`,
        );
        setScannedItem(null);
        return;
      }

      setError("");
      setScannedItem(matchedItem);
      setIsScannerOpen(false);
    },
    [items],
  );

  function closeScanResult() {
    setScannedItem(null);
  }

  function editScannedItem() {
    if (!scannedItem) {
      return;
    }

    const itemToEdit = scannedItem;

    setScannedItem(null);
    setIsScannerOpen(false);
    openEditForm(itemToEdit);
  }

  return (
    <main className="app">
      <section className="inventory-card">
        <header className="page-header">
          <div>
            <p className="eyebrow">
              925 Jewellery
            </p>

            <h1>Inventory</h1>

            <p className="description">
              Manage your jewellery stock in one
              simple place.
            </p>
          </div>

          <div className="header-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={openScanner}
              disabled={
                isLoading || isSaving
              }
            >
              Scan SKU
            </button>

            <button
              className="primary-button"
              type="button"
              onClick={openAddForm}
              disabled={
                isLoading || isSaving
              }
            >
              Add Item
            </button>
          </div>
        </header>

        {isLoading ? (
          <section className="empty-state">
            <h2>
              Loading inventory...
            </h2>

            <p>
              Connecting to your Supabase
              database.
            </p>
          </section>
        ) : (
          <>
            {items.length > 0 && (
              <section
                className="summary-grid"
                aria-label="Inventory summary"
              >
                <div className="summary-card">
                  <p>Total Products</p>
                  <strong>
                    {items.length}
                  </strong>
                </div>

                <div className="summary-card">
                  <p>Total Quantity</p>
                  <strong>
                    {totals.quantity}
                  </strong>
                </div>

                <div className="summary-card">
                  <p>Stock Cost Value</p>
                  <strong>
                    {formatCurrency(
                      totals.costValue,
                    )}
                  </strong>
                </div>

                <div className="summary-card">
                  <p>Selling Value</p>
                  <strong>
                    {formatCurrency(
                      totals.sellingValue,
                    )}
                  </strong>
                </div>
              </section>
            )}

            {items.length === 0 ? (
              <section className="empty-state">
                <h2>
                  No inventory items yet
                </h2>

                <p>
                  Your jewellery items will
                  appear here once you add your
                  first item.
                </p>
              </section>
            ) : (
              <section className="inventory-list">
                <div className="inventory-list-header">
                  <div>
                    <p className="section-label">
                      Your stock
                    </p>

                    <h2>
                      {filteredItems.length} of{" "}
                      {items.length} item
                      {items.length === 1
                        ? ""
                        : "s"}
                    </h2>
                  </div>

                  {!isLabelSelectionMode ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        setIsLabelSelectionMode(
                          true,
                        )
                      }
                      disabled={isSaving}
                    >
                      Select Labels
                    </button>
                  ) : (
                    <div className="label-tools">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={
                          selectAllLabels
                        }
                      >
                        Select All
                      </button>

                      <button
                        className="secondary-button"
                        type="button"
                        onClick={
                          clearLabelSelection
                        }
                      >
                        Clear
                      </button>

                      <button
                        className="secondary-button"
                        type="button"
                        onClick={
                          closeLabelSelectionMode
                        }
                      >
                        Cancel
                      </button>

                      <button
                        className="primary-button"
                        type="button"
                        onClick={
                          downloadSelectedLabels
                        }
                        disabled={
                          selectedLabelIds.length ===
                            0 ||
                          isDownloadingLabels
                        }
                      >
                        {isDownloadingLabels
                          ? "Creating ZIP..."
                          : `Download ${
                              selectedLabelIds.length
                            } Label${
                              selectedLabelIds.length ===
                              1
                                ? ""
                                : "s"
                            }`}
                      </button>
                    </div>
                  )}
                </div>

                <div className="inventory-tools">
                  <div className="search-box">
                    <label htmlFor="inventory-search">
                      Search inventory
                    </label>

                    <input
                      id="inventory-search"
                      type="search"
                      placeholder="Search name, SKU, category..."
                      value={searchTerm}
                      onChange={(event) =>
                        setSearchTerm(
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="filter-box">
                    <label htmlFor="category-filter">
                      Category
                    </label>

                    <select
                      id="category-filter"
                      value={categoryFilter}
                      onChange={(event) =>
                        setCategoryFilter(
                          event.target.value,
                        )
                      }
                    >
                      <option value="All">
                        All categories
                      </option>

                      {categories.map(
                        (category) => (
                          <option
                            key={category}
                            value={category}
                          >
                            {category}
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  {(searchTerm ||
                    categoryFilter !==
                      "All") && (
                    <button
                      className="clear-filter-button"
                      type="button"
                      onClick={
                        clearFilters
                      }
                    >
                      Clear
                    </button>
                  )}
                </div>

                {filteredItems.length ===
                0 ? (
                  <div className="no-results">
                    <h3>
                      No matching items
                    </h3>

                    <p>
                      Try a different search
                      term or remove the
                      category filter.
                    </p>

                    <button
                      className="secondary-button"
                      type="button"
                      onClick={
                        clearFilters
                      }
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <div className="item-grid">
                    {filteredItems.map(
                      (item) => {
                        const isSelected =
                          selectedLabelIds.includes(
                            item.id,
                          );

                        return (
                          <article
                            className={`item-card ${
                              isSelected
                                ? "item-card-selected"
                                : ""
                            }`}
                            key={item.id}
                          >
                            {isLabelSelectionMode && (
                              <label className="label-select-checkbox">
                                <input
                                  type="checkbox"
                                  checked={
                                    isSelected
                                  }
                                  onChange={() =>
                                    toggleLabelSelection(
                                      item.id,
                                    )
                                  }
                                />

                                <span>
                                  Select label
                                </span>
                              </label>
                            )}

                            <div className="item-card-header">
                              <div>
                                <p className="item-category">
                                  {
                                    item.category
                                  }
                                </p>

                                <h3>
                                  {item.name}
                                </h3>
                              </div>

                              <span className="quantity-badge">
                                Qty{" "}
                                {
                                  item.quantity
                                }
                              </span>
                            </div>

                            <dl className="item-details">
                              <div>
                                <dt>SKU</dt>
                                <dd>
                                  {item.sku ||
                                    "—"}
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  Material
                                </dt>
                                <dd>
                                  {
                                    item.material
                                  }
                                </dd>
                              </div>

                              <div>
                                <dt>Cost</dt>
                                <dd>
                                  {item.costPrice
                                    ? formatCurrency(
                                        Number(
                                          item.costPrice,
                                        ),
                                      )
                                    : "—"}
                                </dd>
                              </div>

                              <div>
                                <dt>Weight</dt>
                                <dd>
                                  {item.weight
                                    ? `${Number(
                                        item.weight,
                                      ).toFixed(
                                        3,
                                      )} g`
                                    : "—"}
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  Selling price
                                </dt>
                                <dd>
                                  {item.sellingPrice
                                    ? formatCurrency(
                                        Number(
                                          item.sellingPrice,
                                        ),
                                      )
                                    : "—"}
                                </dd>
                              </div>
                            </dl>

                            {item.notes && (
                              <p className="item-notes">
                                {item.notes}
                              </p>
                            )}

                            <div className="item-actions">
                              {!isLabelSelectionMode && (
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() =>
                                    openBarcode(
                                      item,
                                    )
                                  }
                                  disabled={
                                    isSaving
                                  }
                                >
                                  Barcode
                                </button>
                              )}

                              <button
                                className="edit-button"
                                type="button"
                                onClick={() =>
                                  openEditForm(
                                    item,
                                  )
                                }
                                disabled={
                                  isSaving
                                }
                              >
                                Edit
                              </button>

                              <button
                                className="delete-button"
                                type="button"
                                onClick={() =>
                                  handleDelete(
                                    item,
                                  )
                                }
                                disabled={
                                  isSaving
                                }
                              >
                                Delete
                              </button>
                            </div>
                          </article>
                        );
                      },
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {error && !isFormOpen && (
          <p className="form-error">
            {error}
          </p>
        )}

        {isFormOpen && (
          <div
            className="modal-backdrop"
            onMouseDown={(event) => {
              if (
                event.target ===
                  event.currentTarget &&
                !isSaving
              ) {
                closeForm();
              }
            }}
          >
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="item-form-title"
            >
              <div className="modal-header">
                <div>
                  <p className="eyebrow">
                    Inventory
                  </p>

                  <h2 id="item-form-title">
                    {isEditing
                      ? "Edit Item"
                      : "Add New Item"}
                  </h2>

                  <p>
                    {isEditing
                      ? "Update the details of your jewellery item."
                      : "Enter the details of your jewellery item."}
                  </p>
                </div>

                <button
                  className="close-button"
                  type="button"
                  aria-label="Close form"
                  onClick={closeForm}
                  disabled={isSaving}
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="form-grid">
                  <label>
                    Item Name{" "}
                    <span>*</span>

                    <input
                      name="name"
                      type="text"
                      placeholder="e.g. Silver Ring"
                      value={form.name}
                      onChange={
                        handleChange
                      }
                      autoFocus
                    />
                  </label>

                  <label>
                    SKU / Code

                    <input
                      name="sku"
                      type="text"
                      placeholder="e.g. SR001"
                      value={form.sku}
                      onChange={
                        handleChange
                      }
                    />
                  </label>

                  <label>
                    Category

                    <select
                      name="category"
                      value={
                        form.category
                      }
                      onChange={
                        handleChange
                      }
                    >
                      {categories.map(
                        (category) => (
                          <option
                            key={category}
                            value={category}
                          >
                            {category}
                          </option>
                        ),
                      )}
                    </select>
                  </label>

                  <label>
                    Material

                    <select
                      name="material"
                      value={
                        form.material
                      }
                      onChange={
                        handleChange
                      }
                    >
                      <option value="925 Silver">
                        925 Silver
                      </option>

                      <option value="Silver Plated">
                        Silver Plated
                      </option>

                      <option value="Other">
                        Other
                      </option>
                    </select>
                  </label>

                  <label>
                    Quantity{" "}
                    <span>*</span>

                    <input
                      name="quantity"
                      type="number"
                      min="1"
                      step="1"
                      value={
                        form.quantity
                      }
                      onChange={
                        handleChange
                      }
                    />
                  </label>

                  <label>
                    Weight (g)

                    <input
                      name="weight"
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="e.g. 4.250"
                      value={
                        form.weight
                      }
                      onChange={
                        handleChange
                      }
                    />
                  </label>

                  <label>
                    Cost Price (₹)

                    <input
                      name="costPrice"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={
                        form.costPrice
                      }
                      onChange={
                        handleChange
                      }
                    />
                  </label>

                  <label>
                    Selling Price (₹)

                    <input
                      name="sellingPrice"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={
                        form.sellingPrice
                      }
                      onChange={
                        handleChange
                      }
                    />
                  </label>

                  <label>
                    Notes

                    <input
                      name="notes"
                      type="text"
                      placeholder="e.g. size, weight, design details"
                      value={
                        form.notes
                      }
                      onChange={
                        handleChange
                      }
                    />
                  </label>
                </div>

                {error && (
                  <p className="form-error">
                    {error}
                  </p>
                )}

                <div className="form-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={closeForm}
                    disabled={
                      isSaving
                    }
                  >
                    Cancel
                  </button>

                  <button
                    className="primary-button"
                    type="submit"
                    disabled={
                      isSaving
                    }
                  >
                    {isSaving
                      ? "Saving..."
                      : isEditing
                        ? "Update Item"
                        : "Save Item"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {isScannerOpen && (
          <BarcodeScanner
            onScan={
              handleBarcodeScan
            }
            onClose={
              closeScanner
            }
          />
        )}

        {barcodeItem && (
          <BarcodeGenerator
            item={barcodeItem}
            onClose={
              closeBarcode
            }
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
                  onClick={
                    closeScanResult
                  }
                >
                  ×
                </button>
              </div>

              <dl className="scanner-result-details">
                <div>
                  <dt>SKU</dt>
                  <dd>
                    {scannedItem.sku ||
                      "—"}
                  </dd>
                </div>

                <div>
                  <dt>Category</dt>
                  <dd>
                    {
                      scannedItem.category
                    }
                  </dd>
                </div>

                <div>
                  <dt>Material</dt>
                  <dd>
                    {
                      scannedItem.material
                    }
                  </dd>
                </div>

                <div>
                  <dt>Quantity</dt>
                  <dd>
                    {
                      scannedItem.quantity
                    }
                  </dd>
                </div>

                <div>
                  <dt>Cost</dt>
                  <dd>
                    {scannedItem.costPrice
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
                    {scannedItem.sellingPrice
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
                    <dd>
                      {
                        scannedItem.notes
                      }
                    </dd>
                  </div>
                )}
              </dl>

              <div className="scanner-result-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={
                    closeScanResult
                  }
                >
                  Close
                </button>

                <button
                  className="primary-button"
                  type="button"
                  onClick={
                    editScannedItem
                  }
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

export default App;