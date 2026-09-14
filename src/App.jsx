// src/App.jsx

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import JSZip from "jszip";
import JsBarcode from "jsbarcode";
import * as XLSX from "xlsx";
import "./App.css";
import Dashboard from "./components/Dashboard";
import BarcodeGenerator from "./components/BarcodeGenerator";
import BarcodeScanner from "./components/BarcodeScanner";
import Login from "./components/Login";
import MfaVerify from "./components/MfaVerify";
import {
  createInventoryItem,
  createInventoryItems,
  deleteInventoryItem,
  deleteInventoryItemImage,
  fetchInventoryItems,
  updateInventoryItem,
  updateInventoryItemImage,
} from "./lib/inventory";
import {
  deleteInventoryImage,
  uploadInventoryImage,
} from "./lib/inventoryImages";
import { supabase } from "./lib/supabaseClient";

const STORAGE_KEY = "925-jewellery-inventory";
const MIGRATION_KEY = "925-jewellery-supabase-migrated";
const CUSTOM_CATEGORIES_KEY = "925-jewellery-custom-categories";

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
  imageFile: null,
  imagePreview: "",
  imageUrl: "",
  imagePath: "",
};

const BASE_CATEGORIES = [
  "Ring",
  "Necklace",
  "Bracelet",
  "Earrings",
  "Pendant",
  "Other",
];

const ADD_CATEGORY_VALUE = "__add_new_category__";

const EXCEL_BATCH_SIZE = 500;
const EXCEL_PREVIEW_LIMIT = 100;
const EXCEL_MAX_FILE_SIZE = 20 * 1024 * 1024;

const CATEGORY_PREFIXES = {
  Ring: "RG",
  Necklace: "NC",
  Bracelet: "BR",
  Earrings: "ER",
  Pendant: "PD",
  Other: "OT",
};

const EXCEL_COLUMN_ALIASES = {
  name: [
    "item name",
    "name",
    "product name",
  ],
  sku: [
    "sku",
    "sku code",
    "sku/code",
    "code",
  ],
  category: [
    "category",
    "type",
  ],
  material: [
    "material",
  ],
  quantity: [
    "quantity",
    "qty",
    "stock quantity",
  ],
  weight: [
    "weight",
    "weight g",
    "weight grams",
    "weight (g)",
    "weight in grams",
  ],
  costPrice: [
    "cost price",
    "cost",
    "cost price rs",
    "cost price ₹",
  ],
  sellingPrice: [
    "selling price",
    "selling",
    "sale price",
    "price",
    "selling price rs",
    "selling price ₹",
  ],
  notes: [
    "notes",
    "note",
    "description",
  ],
};

function readCustomCategories() {
  try {
    const savedCategories =
      localStorage.getItem(
        CUSTOM_CATEGORIES_KEY,
      );

    if (!savedCategories) {
      return [];
    }

    const parsedCategories =
      JSON.parse(savedCategories);

    if (!Array.isArray(parsedCategories)) {
      return [];
    }

    const seen = new Set();

    return parsedCategories
      .map((category) =>
        String(category ?? "").trim(),
      )
      .filter((category) => {
        const normalized =
          category.toLowerCase();

        if (
          !category ||
          BASE_CATEGORIES.some(
            (baseCategory) =>
              baseCategory.toLowerCase() ===
              normalized,
          ) ||
          seen.has(normalized)
        ) {
          return false;
        }

        seen.add(normalized);
        return true;
      });
  } catch {
    return [];
  }
}

function uniqueCategories(categories) {
  const seen = new Set();
  const unique = [];

  categories.forEach((category) => {
    const value = String(category ?? "").trim();
    const normalized = value.toLowerCase();

    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    unique.push(value);
  });

  return unique.sort((first, second) =>
    first.localeCompare(
      second,
      undefined,
      {
        sensitivity: "base",
        numeric: true,
      },
    ),
  );
}

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

  const searchableWords = searchableFields.flatMap(
    (field) =>
      normalizeText(field)
        .split(/[\s\-_/.,]+/)
        .filter(Boolean),
  );

  const searchWords = search
    .split(/[\s\-_/.,]+/)
    .filter(Boolean);

  return searchWords.every((searchWord) =>
    searchableWords.some((inventoryWord) =>
      wordMatchesSearch(
        searchWord,
        inventoryWord,
      ),
    ),
  );
}

function readLocalItems() {
  try {
    const savedItems =
      localStorage.getItem(STORAGE_KEY);

    if (!savedItems) {
      return [];
    }

    const parsedItems = JSON.parse(savedItems);

    return Array.isArray(parsedItems)
      ? parsedItems
      : [];
  } catch {
    return [];
  }
}

function getFormFromItem(item) {
  return {
    name: String(item.name ?? ""),
    sku: String(item.sku ?? ""),
    category: String(
      item.category ?? "Ring",
    ),
    material: String(
      item.material ?? "925 Silver",
    ),
    quantity: String(
      item.quantity ?? 1,
    ),
    weight: String(
      item.weight ?? "",
    ),
    costPrice: String(
      item.costPrice ?? "",
    ),
    sellingPrice: String(
      item.sellingPrice ?? "",
    ),
    notes: String(
      item.notes ?? "",
    ),
    imageFile: null,
    imagePreview: String(
      item.imageUrl ?? "",
    ),
    imageUrl: String(
      item.imageUrl ?? "",
    ),
    imagePath: String(
      item.imagePath ?? "",
    ),
  };
}

function getErrorMessage(error) {
  return (
    error?.message ||
    "Something went wrong."
  );
}

function getSafeFileName(value) {
  return (
    String(value || "label")
      .trim()
      .replace(
        /[^a-zA-Z0-9_-]+/g,
        "-",
      )
      .replace(
        /^-+|-+$/g,
        "",
      ) || "label"
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
  return new Promise(
    (resolve, reject) => {
      const sku = String(
        item?.sku ?? "",
      ).trim();

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
          document.createElement(
            "canvas",
          );

        JsBarcode(
          barcodeCanvas,
          sku,
          {
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
          },
        );

        const scale = 3;
        const labelWidth = 700;
        const labelHeight = 450;

        const canvas =
          document.createElement(
            "canvas",
          );

        canvas.width =
          labelWidth * scale;

        canvas.height =
          labelHeight * scale;

        const context =
          canvas.getContext("2d");

        if (!context) {
          reject(
            new Error(
              "Unable to create label image.",
            ),
          );
          return;
        }

        context.scale(
          scale,
          scale,
        );

        context.fillStyle =
          "#ffffff";

        context.fillRect(
          0,
          0,
          labelWidth,
          labelHeight,
        );

        context.strokeStyle =
          "#e3ded8";

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
          item.name ||
            "Jewellery Item",
          labelWidth / 2,
          68,
          "700 28px Arial",
        );

        const category =
          item.category ||
          "Other";

        const weight =
          item.weight !== "" &&
          item.weight !== null &&
          item.weight !== undefined
            ? `${Number(
                item.weight,
              ).toFixed(3)} g`
            : "—";

        drawCenteredText(
          context,
          `Category: ${category}    •    Weight: ${weight}`,
          labelWidth / 2,
          100,
          "600 17px Arial",
        );

        const targetBarcodeWidth =
          560;

        const targetBarcodeHeight =
          125;

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

        context.fillStyle =
          "#8a6d46";

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
    },
  );
}

function downloadBlob(
  blob,
  fileName,
) {
  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function formatCurrency(value) {
  const numericValue =
    Number(value) || 0;

  return `₹${numericValue.toLocaleString(
    "en-IN",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`;
}

function formatWeight(value) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return `${Number(value).toFixed(3)} g`;
}

function revokeBlobPreview(preview) {
  if (
    preview &&
    String(preview).startsWith("blob:")
  ) {
    URL.revokeObjectURL(preview);
  }
}

function normalizeExcelHeader(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[₹$€£]/g, "")
    .replace(/[()]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function findExcelColumn(headers, aliases) {
  const normalizedHeaders = headers.map(
    (header) =>
      normalizeExcelHeader(header),
  );

  for (const alias of aliases) {
    const index =
      normalizedHeaders.indexOf(
        normalizeExcelHeader(alias),
      );

    if (index !== -1) {
      return headers[index];
    }
  }

  return null;
}

function getExcelCell(row, column) {
  if (!column) {
    return "";
  }

  return row[column];
}

function parseExcelNumber(
  value,
  fieldName,
  rowNumber,
  options = {},
) {
  const {
    integer = false,
    minimum = 0,
    optional = true,
  } = options;

  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    if (optional) {
      return null;
    }

    throw new Error(
      `${fieldName} is required on row ${rowNumber}.`,
    );
  }

  const cleanedValue =
    String(value)
      .trim()
      .replace(/[₹,$€£]/g, "")
      .replace(/,/g, "");

  const numberValue =
    Number(cleanedValue);

  if (
    !Number.isFinite(numberValue)
  ) {
    throw new Error(
      `${fieldName} must be a number on row ${rowNumber}.`,
    );
  }

  if (numberValue < minimum) {
    throw new Error(
      `${fieldName} cannot be negative on row ${rowNumber}.`,
    );
  }

  if (
    integer &&
    !Number.isInteger(numberValue)
  ) {
    throw new Error(
      `${fieldName} must be a whole number on row ${rowNumber}.`,
    );
  }

  return numberValue;
}

function getCategoryPrefix(category) {
  const trimmedCategory =
    String(category || "")
      .trim();

  if (
    CATEGORY_PREFIXES[
      trimmedCategory
    ]
  ) {
    return CATEGORY_PREFIXES[
      trimmedCategory
    ];
  }

  const words =
    trimmedCategory
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean);

  if (words.length >= 2) {
    const initials = words
      .map((word) => word[0])
      .join("")
      .toUpperCase();

    if (initials.length >= 2) {
      return initials.slice(0, 2);
    }
  }

  const letters =
    trimmedCategory
      .replace(/[^a-zA-Z]/g, "")
      .toUpperCase();

  if (letters.length >= 2) {
    return letters.slice(0, 2);
  }

  if (letters.length === 1) {
    return `${letters}X`;
  }

  return "OT";
}

function getNextSkuNumber(
  items,
  category,
  reservedNumbers,
) {
  const prefix =
    getCategoryPrefix(
      category,
    );

  let maximumNumber = 0;

  for (const item of items) {
    const sku =
      String(item.sku ?? "")
        .trim()
        .toUpperCase();

    const match =
      sku.match(
        new RegExp(
          `^${prefix}(\\d+)$`,
        ),
      );

    if (match) {
      maximumNumber =
        Math.max(
          maximumNumber,
          Number(match[1]),
        );
    }
  }

  for (
    const number of reservedNumbers
  ) {
    maximumNumber =
      Math.max(
        maximumNumber,
        number,
      );
  }

  return {
    prefix,
    number:
      maximumNumber + 1,
  };
}

function buildGeneratedSku(
  items,
  category,
  counters,
) {
  const prefix =
    getCategoryPrefix(
      category,
    );

  if (!counters.has(prefix)) {
    counters.set(
      prefix,
      getNextSkuNumber(
        items,
        category,
        [],
      ).number - 1,
    );
  }

  const nextNumber =
    counters.get(prefix) + 1;

  counters.set(
    prefix,
    nextNumber,
  );

  return `${prefix}${String(
    nextNumber,
  ).padStart(3, "0")}`;
}

function normalizeSkuValue(value, category) {
  const rawValue = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_-]/g, "");

  if (!rawValue) {
    return "";
  }

  const prefix = getCategoryPrefix(category);

  if (/^\d+$/.test(rawValue)) {
    const number = Number(rawValue);

    if (!Number.isFinite(number)) {
      return "";
    }

    return `${prefix}${String(number).padStart(3, "0")}`;
  }

  const categorySkuMatch = rawValue.match(
    new RegExp(`^${prefix}(\\d+)$`, "i"),
  );

  if (categorySkuMatch) {
    return `${prefix}${String(
      Number(categorySkuMatch[1]),
    ).padStart(3, "0")}`;
  }

  return rawValue;
}

function getNextFormSku(items, category) {
  return buildGeneratedSku(
    items,
    category,
    new Map(),
  );
}

function isSkuAlreadyUsed(
  items,
  sku,
  editingItemId = null,
) {
  const normalizedSku = normalizeImportedSku(sku);

  if (!normalizedSku) {
    return false;
  }

  return items.some(
    (item) =>
      item.id !== editingItemId &&
      normalizeImportedSku(item.sku) === normalizedSku,
  );
}

function normalizeImportedSku(
  value,
) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function createExcelTemplate() {
  const rows = [
    {
      "Item Name":
        "Silver Ring",
      SKU: "RG001",
      Category: "Ring",
      Material: "925 Silver",
      Quantity: 1,
      "Weight (g)": 4.25,
      "Cost Price": 500,
      "Selling Price": 900,
      Notes: "Example item",
    },
  ];

  const worksheet =
    XLSX.utils.json_to_sheet(
      rows,
    );

  worksheet["!cols"] = [
    { wch: 24 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 30 },
  ];

  const workbook =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "Inventory",
  );

  XLSX.writeFile(
    workbook,
    "925-jewellery-import-template.xlsx",
  );
}

function exportInventoryToExcel(
  items,
) {
  const rows = items.map(
    (item) => ({
      "Item Name":
        item.name ?? "",
      SKU:
        item.sku ?? "",
      Category:
        item.category ?? "",
      Material:
        item.material ?? "",
      Quantity:
        Number(item.quantity) || 0,
      "Weight (g)":
        item.weight ?? "",
      "Cost Price":
        item.costPrice ?? "",
      "Selling Price":
        item.sellingPrice ?? "",
      Notes:
        item.notes ?? "",
    }),
  );

  const worksheet =
    XLSX.utils.json_to_sheet(
      rows,
    );

  worksheet["!cols"] = [
    { wch: 24 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 30 },
  ];

  const workbook =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "Inventory",
  );

  XLSX.writeFile(
    workbook,
    `925-jewellery-inventory-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`,
  );
}

function App() {
  const [session, setSession] =
    useState(null);

  const [currentView, setCurrentView] =
    useState("dashboard");

  const [isAuthLoading, setIsAuthLoading] =
    useState(true);

  const [isMfaVerified, setIsMfaVerified] =
    useState(false);

  const [items, setItems] =
    useState([]);

  const [
    customCategories,
    setCustomCategories,
  ] = useState(readCustomCategories);

  const [
    isCategoryModalOpen,
    setIsCategoryModalOpen,
  ] = useState(false);

  const [
    newCategoryName,
    setNewCategoryName,
  ] = useState("");

  const [isLoading, setIsLoading] =
    useState(true);

  const [isSaving, setIsSaving] =
    useState(false);

  const [isFormOpen, setIsFormOpen] =
    useState(false);

  const [
    editingItemId,
    setEditingItemId,
  ] = useState(null);

  const [form, setForm] =
    useState(emptyForm);

  const [error, setError] =
    useState("");

  const [scannerError, setScannerError] =
    useState("");

  const [searchTerm, setSearchTerm] =
    useState("");

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState("All");

  const [
    isScannerOpen,
    setIsScannerOpen,
  ] = useState(false);

  const [
    scannedItem,
    setScannedItem,
  ] = useState(null);

  const [
    barcodeItem,
    setBarcodeItem,
  ] = useState(null);

  const [
    isLabelSelectionMode,
    setIsLabelSelectionMode,
  ] = useState(false);

  const [
    selectedLabelIds,
    setSelectedLabelIds,
  ] = useState([]);

  const [
    isDownloadingLabels,
    setIsDownloadingLabels,
  ] = useState(false);

  const imageInputRef =
    useRef(null);

  const excelInputRef =
    useRef(null);

  const [
    isExcelImportOpen,
    setIsExcelImportOpen,
  ] = useState(false);

  const [
    isParsingExcel,
    setIsParsingExcel,
  ] = useState(false);

  const [
    isImportingExcel,
    setIsImportingExcel,
  ] = useState(false);

  const [
    excelRows,
    setExcelRows,
  ] = useState([]);

  const [
    excelErrors,
    setExcelErrors,
  ] = useState([]);

  const [
    excelFileName,
    setExcelFileName,
  ] = useState("");

  const [
    excelImportProgress,
    setExcelImportProgress,
  ] = useState(0);

  const [
    excelImportResult,
    setExcelImportResult,
  ] = useState(null);

  const isEditing =
    editingItemId !== null;

  const allCategories = useMemo(
    () =>
      uniqueCategories([
        ...BASE_CATEGORIES,
        ...customCategories,
        ...items.map(
          (item) =>
            String(
              item.category ?? "",
            ).trim(),
        ),
      ]),
    [customCategories, items],
  );

  useEffect(() => {
    let cancelled = false;

    async function checkAuthentication() {
      setIsAuthLoading(true);

      try {
        const {
          data: {
            session: currentSession,
          },
        } =
          await supabase.auth.getSession();

        if (cancelled) {
          return;
        }

        setSession(currentSession);

        if (!currentSession) {
          setIsMfaVerified(false);
          return;
        }

        const {
          data: assuranceData,
          error: assuranceError,
        } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

        if (assuranceError) {
          throw assuranceError;
        }

        if (!cancelled) {
          setIsMfaVerified(
            assuranceData?.currentLevel ===
              "aal2",
          );
        }
      } catch (authError) {
        console.error(authError);

        if (!cancelled) {
          setSession(null);
          setIsMfaVerified(false);
        }
      } finally {
        if (!cancelled) {
          setIsAuthLoading(false);
        }
      }
    }

    checkAuthentication();

    const {
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        (_event, currentSession) => {
          if (cancelled) {
            return;
          }

          setSession(currentSession);

          if (!currentSession) {
            setIsMfaVerified(false);
            return;
          }

          window.setTimeout(
            async () => {
              if (cancelled) {
                return;
              }

              try {
                const {
                  data: assuranceData,
                  error: assuranceError,
                } =
                  await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

                if (assuranceError) {
                  throw assuranceError;
                }

                if (!cancelled) {
                  setIsMfaVerified(
                    assuranceData?.currentLevel ===
                      "aal2",
                  );
                }
              } catch (authError) {
                console.error(
                  authError,
                );

                if (!cancelled) {
                  setIsMfaVerified(
                    false,
                  );
                }
              }
            },
            0,
          );
        },
      );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(
      CUSTOM_CATEGORIES_KEY,
      JSON.stringify(customCategories),
    );
  }, [customCategories]);

  useEffect(() => {
    const discoveredCategories =
      items
        .map((item) =>
          String(
            item.category ?? "",
          ).trim(),
        )
        .filter(
          (category) =>
            category &&
            !BASE_CATEGORIES.some(
              (baseCategory) =>
                baseCategory.toLowerCase() ===
                category.toLowerCase(),
            ),
        );

    if (discoveredCategories.length === 0) {
      return;
    }

    setCustomCategories(
      (currentCategories) => {
        const merged =
          uniqueCategories([
            ...currentCategories,
            ...discoveredCategories,
          ]);

        if (
          merged.length ===
          currentCategories.length
        ) {
          return currentCategories;
        }

        return merged;
      },
    );
  }, [items]);

  useEffect(() => {
    if (
      !session ||
      !isMfaVerified
    ) {
      setItems([]);
      setIsLoading(false);
      return undefined;
    }

    let cancelled = false;

    async function loadInventory() {
      setIsLoading(true);
      setError("");

      try {
        let databaseItems =
          await fetchInventoryItems();

        const migrationCompleted =
          localStorage.getItem(
            MIGRATION_KEY,
          ) === "true";

        if (
          !migrationCompleted &&
          databaseItems.length === 0
        ) {
          const localItems =
            readLocalItems();

          if (localItems.length > 0) {
            await createInventoryItems(
              localItems,
            );

            databaseItems =
              await fetchInventoryItems();
          }

          localStorage.setItem(
            MIGRATION_KEY,
            "true",
          );
        }

        if (!cancelled) {
          setItems(
            databaseItems,
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(
              loadError,
            ),
          );
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
  }, [
    session,
    isMfaVerified,
  ]);

  useEffect(() => {
    return () => {
      revokeBlobPreview(
        form.imagePreview,
      );
    };
  }, [form.imagePreview]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const matchesCategory =
          categoryFilter === "All" ||
          String(
            item.category ?? "",
          ) === categoryFilter;

        return (
          matchesCategory &&
          itemMatchesSearch(
            item,
            searchTerm,
          )
        );
      }),
    [
      items,
      searchTerm,
      categoryFilter,
    ],
  );

  const totals = useMemo(
    () =>
      items.reduce(
        (summary, item) => {
          const quantity =
            Number(
              item.quantity,
            ) || 0;

          const weight =
            Number(
              item.weight,
            ) || 0;

          const costPrice =
            Number(
              item.costPrice,
            ) || 0;

          const sellingPrice =
            Number(
              item.sellingPrice,
            ) || 0;

          return {
            quantity:
              summary.quantity +
              quantity,

            weight:
              summary.weight +
              quantity * weight,

            costValue:
              summary.costValue +
              quantity *
                costPrice,

            sellingValue:
              summary.sellingValue +
              quantity *
                sellingPrice,
          };
        },
        {
          quantity: 0,
          weight: 0,
          costValue: 0,
          sellingValue: 0,
        },
      ),
    [items],
  );

  function resetForm() {
    revokeBlobPreview(
      form.imagePreview,
    );

    setForm(emptyForm);
    setEditingItemId(null);

    if (imageInputRef.current) {
      imageInputRef.current.value =
        "";
    }
  }

  function openAddForm() {
    resetForm();

    const category = "Ring";
    const nextSku = getNextFormSku(
      items,
      category,
    );

    setForm({
      ...emptyForm,
      category,
      sku: nextSku,
    });

    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(item) {
    revokeBlobPreview(
      form.imagePreview,
    );

    setForm(
      getFormFromItem(item),
    );

    setEditingItemId(
      item.id,
    );

    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    if (isSaving) {
      return;
    }

    setIsFormOpen(false);
    resetForm();
    setError("");
  }

  function openCategoryCreator() {
    setNewCategoryName("");
    setIsCategoryModalOpen(true);
    setError("");
  }

  function closeCategoryCreator() {
    if (isSaving) {
      return;
    }

    setIsCategoryModalOpen(false);
    setNewCategoryName("");
  }

  function addCustomCategory() {
    const categoryName =
      newCategoryName.trim();

    if (!categoryName) {
      setError(
        "Please enter a category name.",
      );
      return;
    }

    if (categoryName.length > 40) {
      setError(
        "Category name must be 40 characters or fewer.",
      );
      return;
    }

    const alreadyExists =
      allCategories.some(
        (category) =>
          category.toLowerCase() ===
          categoryName.toLowerCase(),
      );

    if (alreadyExists) {
      setError(
        "That category already exists.",
      );
      return;
    }

    setCustomCategories(
      (currentCategories) =>
        uniqueCategories([
          ...currentCategories,
          categoryName,
        ]),
    );

    setForm((currentForm) => ({
      ...currentForm,
      category: categoryName,
      sku: getNextFormSku(
        items,
        categoryName,
      ),
    }));

    setCategoryFilter(categoryName);
    setIsCategoryModalOpen(false);
    setNewCategoryName("");
    setError("");
  }

  function handleChange(event) {
    const {
      name,
      value,
    } = event.target;

    if (name === "sku") {
      setForm((currentForm) => ({
        ...currentForm,
        sku: value
          .toUpperCase()
          .replace(/\s+/g, "")
          .replace(/[^A-Z0-9_-]/g, ""),
      }));

      setError("");
      return;
    }

    if (name === "category") {
      setForm((currentForm) => ({
        ...currentForm,
        category: value,
        sku: getNextFormSku(
          items,
          value,
        ),
      }));

      setError("");
      return;
    }

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));

    setError("");
  }

  function handleSkuBlur() {
    setForm((currentForm) => {
      const normalizedSku =
        normalizeSkuValue(
          currentForm.sku,
          currentForm.category,
        );

      if (
        !normalizedSku &&
        !isEditing
      ) {
        return {
          ...currentForm,
          sku: getNextFormSku(
            items,
            currentForm.category,
          ),
        };
      }

      return {
        ...currentForm,
        sku: normalizedSku,
      };
    });
  }

  function handleImageChange(event) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    if (
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
      ].includes(file.type)
    ) {
      setError(
        "Please choose a JPG, PNG or WebP image.",
      );

      event.target.value = "";
      return;
    }

    

    const nextPreview =
      URL.createObjectURL(file);

    revokeBlobPreview(
      form.imagePreview,
    );

    setForm((currentForm) => ({
      ...currentForm,
      imageFile: file,
      imagePreview:
        nextPreview,
    }));

    setError("");
  }

  function removeSelectedImage() {
    revokeBlobPreview(
      form.imagePreview,
    );

    if (imageInputRef.current) {
      imageInputRef.current.value =
        "";
    }

    setForm((currentForm) => ({
      ...currentForm,
      imageFile: null,
      imagePreview: "",
      imageUrl: "",
      imagePath: "",
    }));

    setError("");
  }

  function validateForm() {
    const name =
      form.name.trim();

    const quantity =
      Number(form.quantity);

    if (!name) {
      return "Please enter an item name.";
    }

    if (!String(form.category ?? "").trim()) {
      return "Please choose or add a category.";
    }

    if (
      !Number.isInteger(
        quantity,
      ) ||
      quantity < 1
    ) {
      return "Quantity must be a whole number greater than 0.";
    }

    if (
      form.costPrice !== "" &&
      !Number.isFinite(
        Number(form.costPrice),
      )
    ) {
      return "Please enter a valid cost price.";
    }

    if (
      form.costPrice !== "" &&
      Number(form.costPrice) < 0
    ) {
      return "Cost price cannot be negative.";
    }

    if (
      form.sellingPrice !== "" &&
      !Number.isFinite(
        Number(form.sellingPrice),
      )
    ) {
      return "Please enter a valid selling price.";
    }

    if (
      form.sellingPrice !== "" &&
      Number(form.sellingPrice) < 0
    ) {
      return "Selling price cannot be negative.";
    }

    if (
      form.weight !== "" &&
      !Number.isFinite(
        Number(form.weight),
      )
    ) {
      return "Please enter a valid weight.";
    }

    if (
      form.weight !== "" &&
      Number(form.weight) < 0
    ) {
      return "Weight cannot be negative.";
    }

    return "";
  }

  async function saveNewItem() {
    const normalizedSku =
      normalizeSkuValue(
        form.sku ||
          getNextFormSku(
            items,
            form.category,
          ),
        form.category,
      );

    if (
      isSkuAlreadyUsed(
        items,
        normalizedSku,
      )
    ) {
      throw new Error(
        `SKU "${normalizedSku}" is already in use. Please enter a different SKU.`,
      );
    }

    const itemForm = {
      ...form,
      sku: normalizedSku,
    };

    const newItem =
      await createInventoryItem(
        itemForm,
      );

    if (!form.imageFile) {
      return newItem;
    }

    let uploadedImage = null;

    try {
      uploadedImage =
        await uploadInventoryImage(
          newItem.id,
          form.imageFile,
        );

      const savedItem =
        await updateInventoryItemImage(
          newItem.id,
          uploadedImage.imageUrl,
          uploadedImage.imagePath,
        );

      return savedItem;
    } catch (imageError) {
      if (uploadedImage?.imagePath) {
        try {
          await deleteInventoryImage(
            uploadedImage.imagePath,
          );
        } catch (cleanupError) {
          console.error(
            "Unable to clean up uploaded image:",
            cleanupError,
          );
        }
      }

      try {
        await deleteInventoryItem(
          newItem.id,
        );
      } catch (cleanupError) {
        console.error(
          "Unable to clean up inventory item:",
          cleanupError,
        );
      }

      throw imageError;
    }
  }

  async function saveExistingItem() {
    const currentItem =
      items.find(
        (item) =>
          item.id ===
          editingItemId,
      );

    if (!currentItem) {
      throw new Error(
        "The item could not be found.",
      );
    }

    const normalizedSku =
      normalizeSkuValue(
        form.sku ||
          getNextFormSku(
            items,
            form.category,
          ),
        form.category,
      );

    if (
      isSkuAlreadyUsed(
        items,
        normalizedSku,
        editingItemId,
      )
    ) {
      throw new Error(
        `SKU "${normalizedSku}" is already in use. Please enter a different SKU.`,
      );
    }

    const itemForm = {
      ...form,
      sku: normalizedSku,
    };

    const hasNewImage =
      Boolean(form.imageFile);

    const imageWasRemoved =
      Boolean(
        currentItem.imagePath,
      ) &&
      !form.imagePath &&
      !hasNewImage;

    if (hasNewImage) {
      let uploadedImage = null;

      try {
        uploadedImage =
          await uploadInventoryImage(
            editingItemId,
            form.imageFile,
          );

        const updatedItem =
          await updateInventoryItem(
            editingItemId,
            itemForm,
          );

        try {
          const imageUpdatedItem =
            await updateInventoryItemImage(
              editingItemId,
              uploadedImage.imageUrl,
              uploadedImage.imagePath,
            );

          if (
            currentItem.imagePath &&
            currentItem.imagePath !==
              uploadedImage.imagePath
          ) {
            try {
              await deleteInventoryImage(
                currentItem.imagePath,
              );
            } catch (cleanupError) {
              console.error(
                "Unable to remove old image:",
                cleanupError,
              );
            }
          }

          return imageUpdatedItem;
        } catch (imageMetadataError) {
          try {
            await updateInventoryItem(
              editingItemId,
              {
                name:
                  currentItem.name,
                sku:
                  currentItem.sku,
                category:
                  currentItem.category,
                material:
                  currentItem.material,
                quantity:
                  String(
                    currentItem.quantity,
                  ),
                weight:
                  currentItem.weight ??
                  "",
                costPrice:
                  currentItem.costPrice ??
                  "",
                sellingPrice:
                  currentItem.sellingPrice ??
                  "",
                notes:
                  currentItem.notes ??
                  "",
              },
            );
          } catch (rollbackError) {
            console.error(
              "Unable to roll back inventory changes:",
              rollbackError,
            );
          }

          if (
            uploadedImage.imagePath
          ) {
            try {
              await deleteInventoryImage(
                uploadedImage.imagePath,
              );
            } catch (cleanupError) {
              console.error(
                "Unable to clean up new image:",
                cleanupError,
              );
            }
          }

          throw imageMetadataError;
        }
      } catch (saveError) {
        if (
          uploadedImage?.imagePath
        ) {
          try {
            await deleteInventoryImage(
              uploadedImage.imagePath,
            );
          } catch (cleanupError) {
            console.error(
              "Unable to clean up uploaded image:",
              cleanupError,
            );
          }
        }

        throw saveError;
      }
    }

    if (imageWasRemoved) {
      const updatedItem =
        await updateInventoryItem(
          editingItemId,
          itemForm,
        );

      await deleteInventoryItemImage(
        editingItemId,
      );

      try {
        await deleteInventoryImage(
          currentItem.imagePath,
        );
      } catch (cleanupError) {
        console.error(
          "Unable to delete removed image:",
          cleanupError,
        );
      }

      return {
        ...updatedItem,
        imageUrl: "",
        imagePath: "",
      };
    }

    const updatedItem =
      await updateInventoryItem(
        editingItemId,
        itemForm,
      );

    return {
      ...updatedItem,
      imageUrl:
        currentItem.imageUrl ||
        "",
      imagePath:
        currentItem.imagePath ||
        "",
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationError =
      validateForm();

    if (validationError) {
      setError(
        validationError,
      );
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const wasEditing =
        isEditing;

      const categoryName =
        String(
          form.category ?? "",
        ).trim();

      if (
        categoryName &&
        !BASE_CATEGORIES.some(
          (baseCategory) =>
            baseCategory.toLowerCase() ===
            categoryName.toLowerCase(),
        )
      ) {
        setCustomCategories(
          (currentCategories) =>
            uniqueCategories([
              ...currentCategories,
              categoryName,
            ]),
        );
      }

      const savedItem =
        wasEditing
          ? await saveExistingItem()
          : await saveNewItem();

      setItems(
        (currentItems) => {
          if (!wasEditing) {
            return [
              savedItem,
              ...currentItems,
            ];
          }

          return currentItems.map(
            (item) =>
              item.id ===
              editingItemId
                ? savedItem
                : item,
          );
        },
      );

      setScannedItem(
        (currentItem) =>
          currentItem?.id ===
          editingItemId
            ? savedItem
            : currentItem,
      );

      revokeBlobPreview(
        form.imagePreview,
      );

      if (imageInputRef.current) {
        imageInputRef.current.value =
          "";
      }

      setIsFormOpen(false);
      setForm(emptyForm);
      setEditingItemId(null);
    } catch (saveError) {
      setError(
        getErrorMessage(
          saveError,
        ),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(item) {
    const shouldDelete =
      window.confirm(
        `Delete "${item.name}" from your inventory?`,
      );

    if (!shouldDelete) {
      return;
    }

    setError("");

    try {
      await deleteInventoryItem(
        item.id,
      );

      if (item.imagePath) {
        try {
          await deleteInventoryImage(
            item.imagePath,
          );
        } catch (cleanupError) {
          console.error(
            "Unable to delete inventory image:",
            cleanupError,
          );
        }
      }

      setItems(
        (currentItems) =>
          currentItems.filter(
            (currentItem) =>
              currentItem.id !==
              item.id,
          ),
      );

      setSelectedLabelIds(
        (currentIds) =>
          currentIds.filter(
            (id) =>
              id !== item.id,
          ),
      );

      if (
        scannedItem?.id ===
        item.id
      ) {
        setScannedItem(null);
      }
    } catch (deleteError) {
      setError(
        getErrorMessage(
          deleteError,
        ),
      );
    }
  }

  async function deleteSelectedItems() {
    const selectedItems =
      items.filter((item) =>
        selectedLabelIds.includes(item.id),
      );

    if (selectedItems.length === 0) {
      setError(
        "Please select at least one item to delete.",
      );
      return;
    }

    const shouldDelete =
      window.confirm(
        `Delete ${selectedItems.length} selected item${
          selectedItems.length === 1 ? "" : "s"
        } from your inventory? This cannot be undone.`,
      );

    if (!shouldDelete) {
      return;
    }

    setError("");

    try {
      for (const item of selectedItems) {
        await deleteInventoryItem(item.id);

        if (item.imagePath) {
          try {
            await deleteInventoryImage(item.imagePath);
          } catch (cleanupError) {
            console.error(
              "Unable to delete inventory image:",
              cleanupError,
            );
          }
        }
      }

      const selectedIds = new Set(
        selectedItems.map((item) => item.id),
      );

      setItems((currentItems) =>
        currentItems.filter(
          (item) => !selectedIds.has(item.id),
        ),
      );

      setSelectedLabelIds((currentIds) =>
        currentIds.filter(
          (id) => !selectedIds.has(id),
        ),
      );

      setScannedItem((currentItem) =>
        currentItem &&
        selectedIds.has(currentItem.id)
          ? null
          : currentItem,
      );

      closeLabelSelectionMode();
    } catch (deleteError) {
      setError(
        getErrorMessage(deleteError),
      );
    }
  }

  function resetExcelImport() {
    setExcelRows([]);
    setExcelErrors([]);
    setExcelFileName("");
    setExcelImportProgress(0);
    setExcelImportResult(null);

    if (excelInputRef.current) {
      excelInputRef.current.value = "";
    }
  }

  function closeExcelImport() {
    if (
      isParsingExcel ||
      isImportingExcel
    ) {
      return;
    }

    setIsExcelImportOpen(false);
    resetExcelImport();
  }

  function openExcelImport() {
    setError("");
    resetExcelImport();
    setIsExcelImportOpen(true);
  }

  function handleExcelFileButton() {
    excelInputRef.current?.click();
  }

  async function handleExcelFileChange(
    event,
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsParsingExcel(true);
    setError("");
    setExcelImportResult(null);
    setExcelFileName(file.name);
    setExcelRows([]);
    setExcelErrors([]);

    try {
      if (
        file.size >
        EXCEL_MAX_FILE_SIZE
      ) {
        throw new Error(
          "Excel file must be 20 MB or smaller.",
        );
      }

      const arrayBuffer =
        await file.arrayBuffer();

      const workbook =
        XLSX.read(
          arrayBuffer,
          {
            type: "array",
            cellDates: false,
          },
        );

      const firstSheetName =
        workbook.SheetNames[0];

      if (!firstSheetName) {
        throw new Error(
          "The Excel file does not contain a worksheet.",
        );
      }

      const worksheet =
        workbook.Sheets[
          firstSheetName
        ];

      const rawRows =
        XLSX.utils.sheet_to_json(
          worksheet,
          {
            defval: "",
            raw: false,
          },
        );

      if (
        rawRows.length === 0
      ) {
        throw new Error(
          "The Excel worksheet is empty.",
        );
      }

      const headers =
        Object.keys(
          rawRows[0],
        );

      const columns = {
        name: findExcelColumn(
          headers,
          EXCEL_COLUMN_ALIASES.name,
        ),
        sku: findExcelColumn(
          headers,
          EXCEL_COLUMN_ALIASES.sku,
        ),
        category:
          findExcelColumn(
            headers,
            EXCEL_COLUMN_ALIASES.category,
          ),
        material:
          findExcelColumn(
            headers,
            EXCEL_COLUMN_ALIASES.material,
          ),
        quantity:
          findExcelColumn(
            headers,
            EXCEL_COLUMN_ALIASES.quantity,
          ),
        weight:
          findExcelColumn(
            headers,
            EXCEL_COLUMN_ALIASES.weight,
          ),
        costPrice:
          findExcelColumn(
            headers,
            EXCEL_COLUMN_ALIASES.costPrice,
          ),
        sellingPrice:
          findExcelColumn(
            headers,
            EXCEL_COLUMN_ALIASES.sellingPrice,
          ),
        notes:
          findExcelColumn(
            headers,
            EXCEL_COLUMN_ALIASES.notes,
          ),
      };

      if (!columns.name) {
        throw new Error(
          "The Excel file must contain an Item Name or Name column.",
        );
      }

      const existingSkus =
        new Set(
          items
            .map((item) =>
              normalizeImportedSku(
                item.sku,
              ),
            )
            .filter(Boolean),
        );

      const importedSkus =
        new Set();

      const generatedCounters =
        new Map();

      const parsedRows = [];
      const errors = [];

      rawRows.forEach(
        (rawRow, index) => {
          const rowNumber =
            index + 2;

          try {
            const name =
              String(
                getExcelCell(
                  rawRow,
                  columns.name,
                ) ?? "",
              ).trim();

            if (!name) {
              throw new Error(
                `Item Name is required on row ${rowNumber}.`,
              );
            }

            const category =
              String(
                getExcelCell(
                  rawRow,
                  columns.category,
                ) ?? "",
              ).trim() ||
              "Other";

            const material =
              String(
                getExcelCell(
                  rawRow,
                  columns.material,
                ) ?? "",
              ).trim() ||
              "925 Silver";

            const quantityValue =
              parseExcelNumber(
                getExcelCell(
                  rawRow,
                  columns.quantity,
                ),
                "Quantity",
                rowNumber,
                {
                  integer: true,
                  minimum: 1,
                  optional: true,
                },
              );

            const quantity =
              quantityValue ?? 1;

            const weight =
              parseExcelNumber(
                getExcelCell(
                  rawRow,
                  columns.weight,
                ),
                "Weight",
                rowNumber,
                {
                  minimum: 0,
                  optional: true,
                },
              );

            const costPrice =
              parseExcelNumber(
                getExcelCell(
                  rawRow,
                  columns.costPrice,
                ),
                "Cost Price",
                rowNumber,
                {
                  minimum: 0,
                  optional: true,
                },
              );

            const sellingPrice =
              parseExcelNumber(
                getExcelCell(
                  rawRow,
                  columns.sellingPrice,
                ),
                "Selling Price",
                rowNumber,
                {
                  minimum: 0,
                  optional: true,
                },
              );

            let sku =
              normalizeImportedSku(
                getExcelCell(
                  rawRow,
                  columns.sku,
                ),
              );

            if (!sku) {
              sku =
                buildGeneratedSku(
                  items,
                  category,
                  generatedCounters,
                );
            }

            if (
              importedSkus.has(sku)
            ) {
              throw new Error(
                `Duplicate SKU "${sku}" found in the Excel file on row ${rowNumber}.`,
              );
            }

            if (
              existingSkus.has(sku)
            ) {
              throw new Error(
                `SKU "${sku}" already exists in your inventory.`,
              );
            }

            importedSkus.add(sku);

            parsedRows.push({
              sourceRow:
                rowNumber,
              name,
              sku,
              category,
              material,
              quantity:
                String(quantity),
              weight:
                weight === null
                  ? ""
                  : String(weight),
              costPrice:
                costPrice === null
                  ? ""
                  : String(costPrice),
              sellingPrice:
                sellingPrice === null
                  ? ""
                  : String(
                      sellingPrice,
                    ),
              notes:
                String(
                  getExcelCell(
                    rawRow,
                    columns.notes,
                  ) ?? "",
                ).trim(),
            });
          } catch (rowError) {
            errors.push(
              rowError.message,
            );
          }
        },
      );

      setExcelRows(
        parsedRows,
      );

      setExcelErrors(
        errors,
      );
    } catch (excelError) {
      setExcelErrors([
        getErrorMessage(
          excelError,
        ),
      ]);
    } finally {
      setIsParsingExcel(false);
    }
  }

  async function importExcelRows() {
    if (
      excelRows.length === 0
    ) {
      setError(
        "There are no valid rows to import.",
      );
      return;
    }

    if (
      excelErrors.length > 0
    ) {
      setError(
        "Please fix all Excel errors before importing.",
      );
      return;
    }

    setIsImportingExcel(true);
    setError("");
    setExcelImportProgress(0);
    setExcelImportResult(null);

    try {
      let importedCount = 0;
      const importedItems = [];

      for (
        let start = 0;
        start < excelRows.length;
        start += EXCEL_BATCH_SIZE
      ) {
        const batch =
          excelRows.slice(
            start,
            start +
              EXCEL_BATCH_SIZE,
          );

        const createdItems =
          await createInventoryItems(
            batch,
          );

        importedItems.push(
          ...createdItems,
        );

        importedCount +=
          batch.length;

        setExcelImportProgress(
          Math.round(
            (importedCount /
              excelRows.length) *
              100,
          ),
        );
      }

      setItems(
        (currentItems) => [
          ...importedItems,
          ...currentItems,
        ],
      );

      setExcelImportResult({
        success: true,
        imported:
          importedCount,
      });
    } catch (importError) {
      setExcelImportResult({
        success: false,
        imported: 0,
        error:
          getErrorMessage(
            importError,
          ),
      });
    } finally {
      setIsImportingExcel(false);
    }
  }

  function exportCurrentInventory() {
    try {
      exportInventoryToExcel(
        items,
      );
      setError("");
    } catch (exportError) {
      setError(
        getErrorMessage(
          exportError,
        ),
      );
    }
  }

  function downloadExcelTemplate() {
    try {
      createExcelTemplate();
      setError("");
    } catch (templateError) {
      setError(
        getErrorMessage(
          templateError,
        ),
      );
    }
  }

  function clearFilters() {
    setSearchTerm("");
    setCategoryFilter("All");
  }

  function openScanner() {
    setScannerError("");
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

  function toggleLabelSelection(
    itemId,
  ) {
    setSelectedLabelIds(
      (currentIds) =>
        currentIds.includes(
          itemId,
        )
          ? currentIds.filter(
              (id) =>
                id !== itemId,
            )
          : [
              ...currentIds,
              itemId,
            ],
    );
  }

  function selectAllLabels() {
    setSelectedLabelIds(
      filteredItems.map(
        (item) => item.id,
      ),
    );
  }

  function clearLabelSelection() {
    setSelectedLabelIds([]);
  }

  function closeLabelSelectionMode() {
    setIsLabelSelectionMode(
      false,
    );
    setSelectedLabelIds([]);
  }

  async function downloadSelectedLabels() {
    const selectedItems =
      filteredItems.filter(
        (item) =>
          selectedLabelIds.includes(
            item.id,
          ),
      );

    if (
      selectedItems.length ===
      0
    ) {
      setError(
        "Please select at least one item.",
      );
      return;
    }

    const itemsWithoutSku =
      selectedItems.filter(
        (item) =>
          !String(
            item.sku ?? "",
          ).trim(),
      );

    if (
      itemsWithoutSku.length >
      0
    ) {
      const names =
        itemsWithoutSku
          .map(
            (item) =>
              item.name ||
              "Unnamed item",
          )
          .join(", ");

      setError(
        `These items need an SKU before labels can be created: ${names}`,
      );
      return;
    }

    setIsDownloadingLabels(
      true,
    );
    setError("");

    try {
      const zip = new JSZip();

      for (const item of selectedItems) {
        const labelBlob =
          await createLabelPng(
            item,
          );

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
      console.error(
        downloadError,
      );

      setError(
        downloadError?.message ||
          "Could not create the label download.",
      );
    } finally {
      setIsDownloadingLabels(
        false,
      );
    }
  }

  const handleBarcodeScan =
    useCallback(
      (scannedCode) => {
        const normalizedCode =
          normalizeText(
            scannedCode,
          );

        if (!normalizedCode) {
          setScannerError(
            "The scanner returned an empty barcode.",
          );
          return;
        }

        const matchedItem =
          items.find(
            (item) =>
              normalizeText(
                item.sku,
              ) ===
              normalizedCode,
          );

        if (!matchedItem) {
          setScannerError(
            `No inventory item was found for SKU "${scannedCode}".`,
          );
          setScannedItem(null);
          return;
        }

        setScannerError("");
        setScannedItem(
          matchedItem,
        );
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

    const itemToEdit =
      scannedItem;

    setScannedItem(null);
    setIsScannerOpen(false);
    setCurrentView("inventory");
    openEditForm(itemToEdit);
  }

  async function handleLogout() {
    setError("");

    const {
      error: logoutError,
    } =
      await supabase.auth.signOut();

    if (logoutError) {
      setError(
        getErrorMessage(
          logoutError,
        ),
      );
    }

    setSession(null);
    setIsMfaVerified(false);
    setCurrentView("dashboard");
    setItems([]);
    setScannerError("");
    setScannedItem(null);
    setBarcodeItem(null);
    setIsScannerOpen(false);
    setIsFormOpen(false);
    setIsCategoryModalOpen(false);
    setNewCategoryName("");
    closeLabelSelectionMode();
    resetForm();
  }

  if (isAuthLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">
              925 Jewellery
            </p>

            <h1>Loading...</h1>

            <p>
              Checking your
              secure session.
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <Login
        onLoginSuccess={(
          newSession,
        ) => {
          setSession(
            newSession,
          );
          setIsMfaVerified(
            false,
          );
        }}
      />
    );
  }

  if (!isMfaVerified) {
    return (
      <MfaVerify
        onVerified={() => {
          setIsMfaVerified(
            true,
          );
          setCurrentView("dashboard");
        }}
      />
    );
  }

  if (currentView === "dashboard") {
    return (
      <Dashboard
        items={items}
        categories={allCategories}
        onOpenInventory={() => {
          setCurrentView("inventory");
        }}
        onScanSku={openScanner}
        onBarcodeScan={handleBarcodeScan}
        isScannerOpen={isScannerOpen}
        scannerError={scannerError}
        scannedItem={scannedItem}
        onCloseScanner={closeScanner}
        onCloseScanResult={closeScanResult}
        onEditScannedItem={editScannedItem}
        onClearScannerError={() => {
          setScannerError("");
        }}
        onLogout={handleLogout}
      />
    );
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
              Manage your jewellery
              stock in one simple
              place.
            </p>
          </div>

          <div className="header-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setCurrentView("dashboard");
              }}
              disabled={
                isLoading ||
                isSaving
              }
            >
              Dashboard
            </button>

            <button
              className="primary-button"
              type="button"
              onClick={
                openAddForm
              }
              disabled={
                isLoading ||
                isSaving
              }
            >
              Add Item
            </button>

            <details className="excel-menu">
              <summary
                className="excel-menu-trigger"
              >
                Excel
              </summary>

              <div className="excel-menu-panel">
                <button
                  className="excel-menu-item"
                  type="button"
                  onClick={(event) => {
                    openExcelImport();
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                  disabled={
                    isLoading ||
                    isSaving ||
                    isImportingExcel
                  }
                >
                  <span
                    className="excel-menu-item-icon"
                    aria-hidden="true"
                  >
                    ↓
                  </span>

                  <span className="excel-menu-item-content">
                    <strong>
                      Import Excel
                    </strong>
                    <span>
                      Add inventory from an Excel file
                    </span>
                  </span>
                </button>

                <button
                  className="excel-menu-item"
                  type="button"
                  onClick={(event) => {
                    exportCurrentInventory();
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                  disabled={
                    isLoading ||
                    isSaving ||
                    items.length === 0
                  }
                >
                  <span
                    className="excel-menu-item-icon"
                    aria-hidden="true"
                  >
                    ↑
                  </span>

                  <span className="excel-menu-item-content">
                    <strong>
                      Export Excel
                    </strong>
                    <span>
                      Download your current inventory
                    </span>
                  </span>
                </button>

                <button
                  className="excel-menu-item"
                  type="button"
                  onClick={(event) => {
                    downloadExcelTemplate();
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                  disabled={
                    isLoading ||
                    isSaving ||
                    isImportingExcel
                  }
                >
                  <span
                    className="excel-menu-item-icon"
                    aria-hidden="true"
                  >
                    □
                  </span>

                  <span className="excel-menu-item-content">
                    <strong>
                      Download Template
                    </strong>
                    <span>
                      Get the Excel import format
                    </span>
                  </span>
                </button>
              </div>
            </details>

            <button
              className="secondary-button"
              type="button"
              onClick={
                handleLogout
              }
            >
              Logout
            </button>
          </div>
        </header>

        {isLoading ? (
          <section className="empty-state">
            <h2>
              Loading inventory...
            </h2>

            <p>
              Connecting to your
              Supabase database.
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
                  <p>
                    Total Products
                  </p>

                  <strong>
                    {items.length}
                  </strong>
                </div>

                <div className="summary-card">
                  <p>
                    Total Quantity
                  </p>

                  <strong>
                    {totals.quantity}
                  </strong>
                </div>

                <div className="summary-card">
                  <p>
                    Stock Cost Value
                  </p>

                  <strong>
                    {formatCurrency(
                      totals.costValue,
                    )}
                  </strong>
                </div>

                <div className="summary-card">
                  <p>
                    Selling Value
                  </p>

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
                  No inventory items
                  yet
                </h2>

                <p>
                  Your jewellery items
                  will appear here once
                  you add your first item.
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
                      {
                        filteredItems.length
                      }{" "}
                      of{" "}
                      {items.length}{" "}
                      item
                      {items.length ===
                      1
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
                      disabled={
                        isSaving
                      }
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
                        className="delete-button bulk-delete-button"
                        type="button"
                        onClick={
                          deleteSelectedItems
                        }
                        disabled={
                          selectedLabelIds.length ===
                            0 ||
                          isSaving ||
                          isDownloadingLabels
                        }
                      >
                        Delete{" "}
                        {selectedLabelIds.length > 0
                          ? selectedLabelIds.length
                          : ""}{" "}
                        Selected
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
                      value={
                        searchTerm
                      }
                      onChange={(
                        event,
                      ) =>
                        setSearchTerm(
                          event.target
                            .value,
                        )
                      }
                    />
                  </div>

                  <div className="filter-box">
                    <div className="category-filter-label">
                      <label htmlFor="category-filter">
                        Category
                      </label>

                      <button
                        className="add-category-button"
                        type="button"
                        onClick={
                          openCategoryCreator
                        }
                      >
                        + Add Category
                      </button>
                    </div>

                    <select
                      id="category-filter"
                      value={
                        categoryFilter
                      }
                      onChange={(
                        event,
                      ) => {
                        const value =
                          event.target.value;

                        if (
                          value ===
                          ADD_CATEGORY_VALUE
                        ) {
                          openCategoryCreator();
                          return;
                        }

                        setCategoryFilter(
                          value,
                        );
                      }}
                    >
                      <option value="All">
                        All categories
                      </option>

                      {allCategories.map(
                        (
                          category,
                        ) => (
                          <option
                            key={
                              category
                            }
                            value={
                              category
                            }
                          >
                            {
                              category
                            }
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
                      No matching
                      items
                    </h3>

                    <p>
                      Try a different
                      search term or
                      remove the
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
                            key={
                              item.id
                            }
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

                            {item.imageUrl && (
                              <div className="item-image">
                                <img
                                  src={
                                    item.imageUrl
                                  }
                                  alt={`${item.name} product`}
                                />
                              </div>
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
                                <dt>
                                  SKU
                                </dt>

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
                                <dt>
                                  Cost
                                </dt>

                                <dd>
                                  {item.costPrice !==
                                    null &&
                                  item.costPrice !==
                                    undefined &&
                                  item.costPrice !==
                                    ""
                                    ? formatCurrency(
                                        Number(
                                          item.costPrice,
                                        ),
                                      )
                                    : "—"}
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  Weight
                                </dt>

                                <dd>
                                  {formatWeight(
                                    item.weight,
                                  )}
                                </dd>
                              </div>

                              <div>
                                <dt>
                                  Selling price
                                </dt>

                                <dd>
                                  {item.sellingPrice !==
                                    null &&
                                  item.sellingPrice !==
                                    undefined &&
                                  item.sellingPrice !==
                                    ""
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
                                {
                                  item.notes
                                }
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

        {error &&
          !isFormOpen && (
            <p className="form-error">
              {error}
            </p>
          )}

        {isExcelImportOpen && (
          <div
            className="modal-backdrop"
            onMouseDown={(event) => {
              if (
                event.target ===
                  event.currentTarget &&
                !isParsingExcel &&
                !isImportingExcel
              ) {
                closeExcelImport();
              }
            }}
          >
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="excel-import-title"
            >
              <div className="modal-header">
                <div>
                  <p className="eyebrow">
                    Inventory
                  </p>

                  <h2 id="excel-import-title">
                    Import Excel
                  </h2>

                  <p>
                    Import large inventory files safely in batches.
                  </p>
                </div>

                <button
                  className="close-button"
                  type="button"
                  aria-label="Close Excel import"
                  onClick={closeExcelImport}
                  disabled={
                    isParsingExcel ||
                    isImportingExcel
                  }
                >
                  ×
                </button>
              </div>

              <div className="form-grid">
                <div>
                  <label>
                    Excel File
                  </label>

                  <input
                    ref={excelInputRef}
                    className="image-file-input"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={
                      handleExcelFileChange
                    }
                  />

                  <button
                    className="secondary-button"
                    type="button"
                    onClick={
                      handleExcelFileButton
                    }
                    disabled={
                      isParsingExcel ||
                      isImportingExcel
                    }
                  >
                    Choose Excel File
                  </button>

                  {excelFileName && (
                    <p
                      style={{
                        marginTop: "10px",
                        color: "#555",
                        fontSize: "14px",
                      }}
                    >
                      {excelFileName}
                    </p>
                  )}

                  <small
                    style={{
                      display: "block",
                      marginTop: "8px",
                      color: "#777",
                      lineHeight: 1.5,
                    }}
                  >
                    Required column: Item Name.
                    SKU is optional; blank SKUs are generated automatically.
                    Quantity defaults to 1.
                  </small>
                </div>

                <div>
                  <p
                    style={{
                      margin: 0,
                      color: "#303030",
                      fontSize: "14px",
                      fontWeight: 600,
                    }}
                  >
                    Supported columns
                  </p>

                  <p
                    style={{
                      margin: "8px 0 0",
                      color: "#777",
                      fontSize: "13px",
                      lineHeight: 1.6,
                    }}
                  >
                    Item Name · SKU · Category · Material · Quantity ·
                    Weight (g) · Cost Price · Selling Price · Notes
                  </p>
                </div>

              </div>

              {isParsingExcel && (
                <div
                  style={{
                    marginTop: "20px",
                    padding: "14px",
                    borderRadius: "10px",
                    background: "#faf9f7",
                    color: "#555",
                  }}
                >
                  Reading and validating the Excel file...
                </div>
              )}

              {!isParsingExcel &&
                excelFileName && (
                  <div
                    style={{
                      marginTop: "20px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        marginBottom: "10px",
                      }}
                    >
                      <strong>
                        Preview
                      </strong>

                      <span
                        style={{
                          color: "#777",
                          fontSize: "13px",
                        }}
                      >
                        Showing first{" "}
                        {Math.min(
                          excelRows.length,
                          EXCEL_PREVIEW_LIMIT,
                        )}{" "}
                        valid rows
                      </span>
                    </div>

                    {excelErrors.length >
                      0 && (
                      <div
                        style={{
                          marginBottom: "16px",
                          padding: "14px",
                          borderRadius: "10px",
                          background: "#fff1ef",
                          color: "#a24b3b",
                          fontSize: "13px",
                          lineHeight: 1.5,
                          maxHeight: "180px",
                          overflowY: "auto",
                        }}
                      >
                        <strong>
                          {excelErrors.length}{" "}
                          error
                          {excelErrors.length ===
                          1
                            ? ""
                            : "s"}
                        </strong>

                        <ul
                          style={{
                            margin:
                              "8px 0 0",
                            paddingLeft:
                              "20px",
                          }}
                        >
                          {excelErrors
                            .slice(
                              0,
                              50,
                            )
                            .map(
                              (
                                excelError,
                                index,
                              ) => (
                                <li
                                  key={
                                    `${excelError}-${index}`
                                  }
                                >
                                  {
                                    excelError
                                  }
                                </li>
                              ),
                            )}
                        </ul>

                        {excelErrors.length >
                          50 && (
                          <p>
                            Showing first 50 errors.
                          </p>
                        )}
                      </div>
                    )}

                    {excelRows.length >
                      0 && (
                      <div
                        style={{
                          overflowX:
                            "auto",
                          border:
                            "1px solid #e3ded8",
                          borderRadius:
                            "10px",
                        }}
                      >
                        <table
                          style={{
                            width: "100%",
                            minWidth:
                              "850px",
                            borderCollapse:
                              "collapse",
                            fontSize:
                              "12px",
                          }}
                        >
                          <thead>
                            <tr>
                              {[
                                "Row",
                                "Item Name",
                                "SKU",
                                "Category",
                                "Qty",
                                "Weight",
                                "Cost",
                                "Selling",
                              ].map(
                                (
                                  heading,
                                ) => (
                                  <th
                                    key={
                                      heading
                                    }
                                    style={{
                                      padding:
                                        "10px",
                                      textAlign:
                                        "left",
                                      borderBottom:
                                        "1px solid #e3ded8",
                                      whiteSpace:
                                        "nowrap",
                                    }}
                                  >
                                    {
                                      heading
                                    }
                                  </th>
                                ),
                              )}
                            </tr>
                          </thead>

                          <tbody>
                            {excelRows
                              .slice(
                                0,
                                EXCEL_PREVIEW_LIMIT,
                              )
                              .map(
                                (
                                  row,
                                ) => (
                                  <tr
                                    key={
                                      row.sourceRow
                                    }
                                  >
                                    <td
                                      style={{
                                        padding:
                                          "9px 10px",
                                        borderBottom:
                                          "1px solid #f0eeeb",
                                      }}
                                    >
                                      {
                                        row.sourceRow
                                      }
                                    </td>

                                    <td
                                      style={{
                                        padding:
                                          "9px 10px",
                                        borderBottom:
                                          "1px solid #f0eeeb",
                                      }}
                                    >
                                      {
                                        row.name
                                      }
                                    </td>

                                    <td
                                      style={{
                                        padding:
                                          "9px 10px",
                                        borderBottom:
                                          "1px solid #f0eeeb",
                                      }}
                                    >
                                      {
                                        row.sku
                                      }
                                    </td>

                                    <td
                                      style={{
                                        padding:
                                          "9px 10px",
                                        borderBottom:
                                          "1px solid #f0eeeb",
                                      }}
                                    >
                                      {
                                        row.category
                                      }
                                    </td>

                                    <td
                                      style={{
                                        padding:
                                          "9px 10px",
                                        borderBottom:
                                          "1px solid #f0eeeb",
                                      }}
                                    >
                                      {
                                        row.quantity
                                      }
                                    </td>

                                    <td
                                      style={{
                                        padding:
                                          "9px 10px",
                                        borderBottom:
                                          "1px solid #f0eeeb",
                                      }}
                                    >
                                      {
                                        row.weight ||
                                        "—"
                                      }
                                    </td>

                                    <td
                                      style={{
                                        padding:
                                          "9px 10px",
                                        borderBottom:
                                          "1px solid #f0eeeb",
                                      }}
                                    >
                                      {
                                        row.costPrice ||
                                        "—"
                                      }
                                    </td>

                                    <td
                                      style={{
                                        padding:
                                          "9px 10px",
                                        borderBottom:
                                          "1px solid #f0eeeb",
                                      }}
                                    >
                                      {
                                        row.sellingPrice ||
                                        "—"
                                      }
                                    </td>
                                  </tr>
                                ),
                              )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {excelRows.length >
                      0 && (
                      <p
                        style={{
                          margin:
                            "12px 0 0",
                          color: "#777",
                          fontSize: "13px",
                        }}
                      >
                        {excelRows.length.toLocaleString(
                          "en-IN",
                        )}{" "}
                        valid row
                        {excelRows.length ===
                        1
                          ? ""
                          : "s"}{" "}
                        ready to import.
                      </p>
                    )}
                  </div>
                )}

              {isImportingExcel && (
                <div
                  style={{
                    marginTop: "20px",
                    padding: "14px",
                    borderRadius: "10px",
                    background: "#faf9f7",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "8px",
                      color: "#555",
                      fontSize: "13px",
                    }}
                  >
                    <span>
                      Importing inventory...
                    </span>

                    <strong>
                      {
                        excelImportProgress
                      }
                      %
                    </strong>
                  </div>

                  <div
                    style={{
                      width: "100%",
                      height: "8px",
                      overflow: "hidden",
                      borderRadius: "999px",
                      background: "#e5e1dc",
                    }}
                  >
                    <div
                      style={{
                        width: `${excelImportProgress}%`,
                        height: "100%",
                        background: "#8a6d46",
                        transition:
                          "width 0.2s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              {excelImportResult && (
                <div
                  style={{
                    marginTop: "20px",
                    padding: "14px",
                    borderRadius: "10px",
                    background:
                      excelImportResult.success
                        ? "#f2f8f2"
                        : "#fff1ef",
                    color:
                      excelImportResult.success
                        ? "#416b45"
                        : "#a24b3b",
                    fontSize: "14px",
                    lineHeight: 1.5,
                  }}
                >
                  {excelImportResult.success
                    ? `Successfully imported ${excelImportResult.imported.toLocaleString(
                        "en-IN",
                      )} item${
                        excelImportResult.imported ===
                        1
                          ? ""
                          : "s"
                      }.`
                    : `Import failed: ${excelImportResult.error}`}
                </div>
              )}

              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={
                    closeExcelImport
                  }
                  disabled={
                    isParsingExcel ||
                    isImportingExcel
                  }
                >
                  {excelImportResult?.success
                    ? "Close"
                    : "Cancel"}
                </button>

                {!excelImportResult?.success && (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={
                      importExcelRows
                    }
                    disabled={
                      isParsingExcel ||
                      isImportingExcel ||
                      excelRows.length ===
                        0 ||
                      excelErrors.length >
                        0
                    }
                  >
                    {isImportingExcel
                      ? "Importing..."
                      : `Import ${
                          excelRows.length.toLocaleString(
                            "en-IN",
                          )
                        } Items`}
                  </button>
                )}
              </div>
            </section>
          </div>
        )}

        {isCategoryModalOpen && (
          <div
            className="modal-backdrop"
            onMouseDown={(event) => {
              if (
                event.target === event.currentTarget &&
                !isSaving
              ) {
                closeCategoryCreator();
              }
            }}
          >
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="category-creator-title"
            >
              <div className="modal-header">
                <div>
                  <p className="eyebrow">
                    Inventory
                  </p>

                  <h2 id="category-creator-title">
                    Add New Category
                  </h2>

                  <p>
                    Enter the category name. The SKU prefix and
                    next SKU number will be generated automatically.
                  </p>
                </div>

                <button
                  className="close-button"
                  type="button"
                  aria-label="Close category dialog"
                  onClick={closeCategoryCreator}
                  disabled={isSaving}
                >
                  ×
                </button>
              </div>

              <div className="form-grid">
                <label>
                  Category Name <span>*</span>

                  <input
                    type="text"
                    placeholder="e.g. Anklet"
                    value={newCategoryName}
                    onChange={(event) => {
                      setNewCategoryName(
                        event.target.value,
                      );
                      setError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addCustomCategory();
                      }
                    }}
                    autoFocus
                    maxLength={40}
                  />
                </label>

                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: "10px",
                    background: "#faf9f7",
                    border: "1px solid #e3ded8",
                    alignSelf: "end",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      color: "#777",
                      fontSize: "12px",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    Automatic SKU
                  </p>

                  <strong
                    style={{
                      display: "block",
                      marginTop: "6px",
                      color: "#8a6d46",
                      fontSize: "22px",
                    }}
                  >
                    {newCategoryName.trim()
                      ? getNextFormSku(
                          items,
                          newCategoryName.trim(),
                        )
                      : "—"}
                  </strong>

                  <small
                    style={{
                      display: "block",
                      marginTop: "5px",
                      color: "#777",
                    }}
                  >
                    The prefix uses the first two letters of the
                    category.
                  </small>
                </div>
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
                  onClick={closeCategoryCreator}
                  disabled={isSaving}
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  type="button"
                  onClick={addCustomCategory}
                  disabled={
                    isSaving ||
                    !newCategoryName.trim()
                  }
                >
                  Add Category
                </button>
              </div>
            </section>
          </div>
        )}

        {isFormOpen && (
          <div
            className="modal-backdrop"
            onMouseDown={(
              event,
            ) => {
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
                  onClick={
                    closeForm
                  }
                  disabled={
                    isSaving
                  }
                >
                  ×
                </button>
              </div>

              <form
                onSubmit={
                  handleSubmit
                }
              >
                <div className="form-grid">
                  <label>
                    Item Name{" "}
                    <span>*</span>

                    <input
                      name="name"
                      type="text"
                      placeholder="e.g. Silver Ring"
                      value={
                        form.name
                      }
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
                      placeholder="e.g. RG001 or 12"
                      value={
                        form.sku
                      }
                      onChange={
                        handleChange
                      }
                      onBlur={
                        handleSkuBlur
                      }
                      autoCapitalize="characters"
                      spellCheck={false}
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
                      {allCategories.map(
                        (
                          category,
                        ) => (
                          <option
                            key={
                              category
                            }
                            value={
                              category
                            }
                          >
                            {
                              category
                            }
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

                  <div className="image-upload-field">
                    <div className="image-upload-label">
                      <span>
                        Product Photo
                      </span>

                      <small>
                        Optional
                      </small>
                    </div>

                    {form.imagePreview ? (
                      <div className="image-upload-preview">
                        <img
                          src={
                            form.imagePreview
                          }
                          alt="Product preview"
                        />

                        <button
                          className="remove-image-button"
                          type="button"
                          onClick={
                            removeSelectedImage
                          }
                          disabled={
                            isSaving
                          }
                        >
                          Remove Photo
                        </button>
                      </div>
                    ) : (
                      <button
                        className="image-upload-button"
                        type="button"
                        onClick={() =>
                          imageInputRef.current?.click()
                        }
                        disabled={
                          isSaving
                        }
                      >
                        Choose Photo
                      </button>
                    )}

                    <input
                      ref={
                        imageInputRef
                      }
                      className="image-file-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={
                        handleImageChange
                      }
                    />

                    <small className="image-upload-help">
                      JPG, PNG or WebP ·
                      image will be compressed automatically
                    </small>
                  </div>
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
                    onClick={
                      closeForm
                    }
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

        {barcodeItem && (
          <BarcodeGenerator
            item={barcodeItem}
            onClose={
              closeBarcode
            }
          />
        )}

      </section>
    </main>
  );
}

export default App;