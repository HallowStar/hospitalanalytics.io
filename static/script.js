document.addEventListener("DOMContentLoaded", () => {
  // === 1. SETUP & ELEMENT GATHERING ===

  // Server Configuration: MUST be 5000 to match Flask app.py
  const API_URL = "http://127.0.0.1:5000/upload-and-clean";

  // DOM Elements
  const body = document.body;
  const fileArea = document.querySelector(".file-area");
  const fileInput = document.getElementById("csvFile");
  const tabs = document.querySelectorAll(".state-tabs button");
  const uploadContent = document.querySelector(".upload-content");
  const loadingContent = document.querySelector(".loading-content");
  const tablePlaceholder = document.getElementById("table-placeholder");
  const analyticsContent = document.getElementById("analytics-content");
  const dataTableContent = document.getElementById("data-table-content");
  const predictionContent = document.getElementById("prediction-content");

  // Storage Keys and Flags
  const DATA_LOADED_KEY = "hospitalDataLoaded";
  const DATA_URL_KEY = "cleanedFileUrl";
  const DATA_STORAGE_KEY = "dashboardData";

  // PAGINATION VARIABLES
  const ROWS_PER_PAGE = 100;
  let fullCleanedData = [];
  let currentFilteredData = [];
  let currentDataHeaders = [];
  let currentPage = 1;
  let dataTableGenerated = false;
  let uniqueConditions = [];

  // --- Column Index Mapping (CORRECTED for index=True in Python) ---
  const COLUMN_INDICES = {
    NAME: 1,
    AGE: 2,
    MEDICAL_CONDITION: 5,
    DOCTOR: 7,
    HOSPITAL: 8,
    BILLING_AMOUNT: 10,
  };

  // === METRICS CALCULATION AND RENDERING ===

  function calculateMetrics(dataSet) {
    let totalBilling = 0;
    const uniqueDoctors = new Set();
    const uniqueHospitals = new Set();
    const totalRecords = dataSet.length;

    dataSet.forEach((row) => {
      const billing = parseFloat(row[COLUMN_INDICES.BILLING_AMOUNT]);
      if (!isNaN(billing)) {
        totalBilling += billing;
      }
      uniqueDoctors.add(row[COLUMN_INDICES.DOCTOR]);
      uniqueHospitals.add(row[COLUMN_INDICES.HOSPITAL]);
    });

    const totalDoctors = uniqueDoctors.size;
    const totalHospitals = uniqueHospitals.size;
    const averageBill = totalRecords > 0 ? totalBilling / totalRecords : 0;

    function formatMillions(num) {
      if (num >= 1000000) {
        return `$${(num / 1000000).toFixed(1)}M`;
      } else if (num >= 1000) {
        return `$${(num / 1000).toFixed(1)}K`;
      }
      return `$${num.toFixed(2)}`;
    }

    return {
      totalBilling: formatMillions(totalBilling),
      averageBill: formatMillions(averageBill),
      totalDoctors: totalDoctors,
      totalHospitals: totalHospitals,
      totalPatients: totalRecords,
    };
  }

  /**
   * Updates the HTML metric cards using the calculated values.
   */
  // In script.js:

  function updateMetricCardsDOM(metrics) {
    // 1. Total Billing
    const billingValue = document.querySelector(
      ".metric-card:nth-child(1) .value"
    );
    if (billingValue) billingValue.textContent = metrics.totalBilling;

    const billingDetail = document.querySelector(
      ".metric-card:nth-child(1) .detail"
    );
    if (billingDetail)
      billingDetail.textContent = `${metrics.totalPatients} patients`;

    // 2. Average Bill
    const averageValue = document.querySelector(
      ".metric-card:nth-child(2) .value"
    );
    if (averageValue) averageValue.textContent = metrics.averageBill;

    // 3. Total Doctors
    const doctorsValue = document.querySelector(
      ".metric-card:nth-child(3) .value"
    );
    if (doctorsValue) doctorsValue.textContent = metrics.totalDoctors;

    // 4. Total Hospitals
    const hospitalsValue = document.querySelector(
      ".metric-card:nth-child(4) .value"
    );
    if (hospitalsValue) hospitalsValue.textContent = metrics.totalHospitals;

    // --- FIX: Target the new span to update the record count only ---
    const bannerCount = document.getElementById("recordCountDisplay");
    if (bannerCount)
      bannerCount.textContent = `${metrics.totalPatients} records loaded`;
  }

  // --- Core Dashboard Functions ---

  function showAnalyticsState(metrics = null) {
    localStorage.setItem(DATA_LOADED_KEY, "true");
    body.classList.add("show-analytics");
    body.classList.remove("show-upload");

    if (uploadContent) uploadContent.classList.add("hidden");
    if (loadingContent) loadingContent.classList.add("hidden");

    if (metrics) {
      updateMetricCardsDOM(metrics);
    }

    const defaultTab = document.querySelector('.tab[data-tab="analytics"]');
    if (defaultTab) {
      tabs.forEach((t) => t.classList.remove("active"));
      defaultTab.classList.add("active");

      if (analyticsContent) analyticsContent.classList.remove("hidden-content");
      if (dataTableContent) dataTableContent.classList.add("hidden-content");
      if (predictionContent) predictionContent.classList.add("hidden-content");
    }
  }

  // --- Initial Check (Load Metadata from LocalStorage) ---
  const storedDataString = localStorage.getItem(DATA_STORAGE_KEY);
  if (localStorage.getItem(DATA_LOADED_KEY) === "true" && storedDataString) {
    const parsedData = JSON.parse(storedDataString);

    // Initialize global metadata from storage
    currentDataHeaders = parsedData.headers;
    uniqueConditions = parsedData.conditions;

    // Display stored metrics immediately
    showAnalyticsState(parsedData.metrics);
  } else {
    body.classList.remove("show-analytics");
    body.classList.add("show-upload");
  }

  // === 2. DATA TABLE RENDERING AND FILTERING ===

  function renderConditionFilter() {
    const conditionInput = document.getElementById("filterCondition");
    if (!conditionInput) return;

    let selectHtml = `<select id="filterCondition" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px; width: 150px;">`;
    selectHtml += `<option value="">-- Any Condition --</option>`;

    uniqueConditions.forEach((condition) => {
      selectHtml += `<option value="${condition}">${condition}</option>`;
    });
    selectHtml += `</select>`;

    const parentDiv = conditionInput.parentNode;
    if (parentDiv) {
      parentDiv.innerHTML = parentDiv.innerHTML.replace(
        conditionInput.outerHTML,
        selectHtml
      );
    }
  }

  /**
   * Renders the HTML table based on the specified dataSet and page number.
   */
  function renderTablePage(pageNumber, dataSet = currentFilteredData) {
    if (
      dataSet.length === 0 &&
      document.getElementById("tableSearchInput").value.trim() !== ""
    ) {
      tablePlaceholder.innerHTML = `<p style="padding: 20px;">No results found for your search term or filters.</p>`;
      return;
    }

    // Update metrics based on the current filtered dataset
    const metrics = calculateMetrics(dataSet);
    updateMetricCardsDOM(metrics);

    const totalRows = dataSet.length;
    const totalPages = Math.ceil(totalRows / ROWS_PER_PAGE);

    if (pageNumber < 1) pageNumber = 1;
    if (pageNumber > totalPages && totalPages > 0) pageNumber = totalPages;
    if (totalPages === 0) pageNumber = 0;

    currentPage = pageNumber;
    const startIndex = (pageNumber - 1) * ROWS_PER_PAGE;
    const endIndex = Math.min(startIndex + ROWS_PER_PAGE, totalRows);

    const pageData = dataSet.slice(startIndex, endIndex);

    let html = '<table class="data-table"><thead><tr>';
    currentDataHeaders.forEach((h) => {
      html += `<th>${h}</th>`;
    });
    html += "</tr></thead><tbody>";

    pageData.forEach((cells) => {
      html += "<tr>";
      cells.forEach((cell) => {
        html += `<td>${cell}</td>`;
      });
      html += "</tr>";
    });
    html += "</tbody></table>";

    // Add Pagination Controls
    html += `
            <div class="pagination-controls">
                <span style="font-size: 0.85em; color: #999; margin-right: 15px;">
                    Total Records: ${totalRows}
                </span>
                
                ${
                  totalPages > 0
                    ? `
                    <button id="prevPage" ${
                      currentPage === 1 ? "disabled" : ""
                    }>Previous</button>
                    <span style="margin: 0 10px;">Page </span>
                    <input type="number" id="pageJumpInput" min="1" max="${totalPages}" value="${currentPage}" style="width: 50px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 5px;">
                    <span style="margin: 0 10px;">of ${totalPages}</span>
                    <button id="nextPage" ${
                      currentPage === totalPages ? "disabled" : ""
                    }>Next</button>
                `
                    : ""
                }
            </div>
        `;

    tablePlaceholder.innerHTML = html;

    // Attach listeners after rendering the table/pagination HTML
    if (totalPages > 0) {
      document
        .getElementById("prevPage")
        .addEventListener("click", () => renderTablePage(currentPage - 1));
      document
        .getElementById("nextPage")
        .addEventListener("click", () => renderTablePage(currentPage + 1));
      document
        .getElementById("pageJumpInput")
        .addEventListener("change", (e) => {
          const newPage = parseInt(e.target.value);
          if (!isNaN(newPage) && newPage >= 1 && newPage <= totalPages) {
            renderTablePage(newPage);
          } else {
            e.target.value = currentPage;
          }
        });
    }

    // Re-attach filter listeners
    const searchInput = document.getElementById("tableSearchInput");
    if (searchInput) {
      searchInput.addEventListener("keyup", performGlobalSearch);
      if (currentFilteredData !== fullCleanedData) {
        searchInput.value = localStorage.getItem("currentSearchTerm") || "";
      }
    }
    document
      .getElementById("applyFilterButton")
      .addEventListener("click", applyMultiFilter);
    document
      .getElementById("resetFilterButton")
      .addEventListener("click", resetMultiFilters);
  }

  /**
   * Parses the full CSV text and saves only metadata/metrics to localStorage.
   */
  function parseAndStoreCSV(csvText) {
    if (!csvText) return;

    const rows = csvText.trim().split("\n");

    // 1. Rename the index header column
    currentDataHeaders = rows[0]
      .split(",")
      .map((h) => h.trim().replace(/['']/g, ""));
    if (currentDataHeaders[0] === "") {
      currentDataHeaders[0] = "No";
    }

    // 2. Store data and populate unique conditions
    const conditionSet = new Set();
    fullCleanedData = [];

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i]
        .split(",")
        .map((cell) => cell.trim().replace(/[""]/g, ""));
      fullCleanedData.push(cells);
      conditionSet.add(cells[COLUMN_INDICES.MEDICAL_CONDITION]);
    }

    uniqueConditions = Array.from(conditionSet).sort();

    currentFilteredData = fullCleanedData;
    dataTableGenerated = true;

    // 3. Calculate metrics for the full dataset before saving
    const initialMetrics = calculateMetrics(fullCleanedData);

    // 4. Save only the metadata and metrics (NO RAW DATA) to localStorage
    localStorage.setItem(
      DATA_STORAGE_KEY,
      JSON.stringify({
        headers: currentDataHeaders,
        conditions: uniqueConditions,
        metrics: initialMetrics, // Saved the metrics here
      })
    );

    renderConditionFilter();
    renderTablePage(1);
  }

  /**
   * Filters the entire dataset, restricted ONLY to the Name column (index 0).
   */
  function performGlobalSearch() {
    const input = document.getElementById("tableSearchInput");
    const filterText = input.value.toUpperCase();

    localStorage.setItem("currentSearchTerm", input.value);

    if (filterText === "") {
      applyMultiFilter();
      return;
    }

    currentFilteredData = fullCleanedData.filter((row) => {
      const nameValue = row[COLUMN_INDICES.NAME];
      return nameValue.toUpperCase().includes(filterText);
    });

    renderTablePage(1, currentFilteredData);
  }

  /**
   * Applies complex filtering based on dedicated input fields (button press).
   */
  function applyMultiFilter() {
    const doctor = document.getElementById("filterDoctor").value.toUpperCase();
    const minAge = parseInt(document.getElementById("filterMinAge").value);
    const condition = document
      .getElementById("filterCondition")
      .value.toUpperCase();

    // 1. Reset quick search field and filter flag
    document.getElementById("tableSearchInput").value = "";
    localStorage.removeItem("currentSearchTerm");

    let results = fullCleanedData;

    // Filter 1: Doctor Match
    if (doctor) {
      results = results.filter((row) => {
        const doctorName = row[COLUMN_INDICES.DOCTOR];
        return doctorName && doctorName.toUpperCase().includes(doctor);
      });
    }

    // Filter 2: Min Age
    if (!isNaN(minAge) && minAge > 0) {
      results = results.filter((row) => {
        const age = parseInt(row[COLUMN_INDICES.AGE]);
        return !isNaN(age) && age >= minAge;
      });
    }

    // Filter 3: Medical Condition (Exact Match from Select Box)
    if (condition) {
      results = results.filter((row) => {
        const medicalCondition = row[COLUMN_INDICES.MEDICAL_CONDITION];
        return medicalCondition && medicalCondition.toUpperCase() === condition;
      });
    }

    currentFilteredData = results;
    renderTablePage(1, currentFilteredData);
  }

  /**
   * Clears all dedicated filter inputs and resets the table view.
   */
  function resetMultiFilters() {
    document.getElementById("filterDoctor").value = "";
    document.getElementById("filterMinAge").value = "";
    document.getElementById("filterCondition").value = "";
    document.getElementById("tableSearchInput").value = "";
    localStorage.removeItem("currentSearchTerm");

    currentFilteredData = fullCleanedData;
    renderTablePage(1, currentFilteredData);
  }

  async function loadDataTable() {
    // CHECK 1: If data is already in memory from a previous tab switch, render it instantly.
    if (fullCleanedData.length > 0) {
      renderTablePage(currentPage, currentFilteredData);
      return;
    }

    const fileUrl = localStorage.getItem(DATA_URL_KEY);
    if (!fileUrl) {
      tablePlaceholder.innerHTML =
        '<p style="color: red; padding: 20px;">Error: No clean data URL found. Please re-upload the file.</p>';
      return;
    }

    tablePlaceholder.innerHTML =
      '<div class="spinner"></div><p style="margin-top: 15px;">Loading ALL data from server...</p>';

    try {
      // CHECK 2: Fetch data from server (since it's not in memory/storage)
      const response = await fetch(`http://127.0.0.1:5000${fileUrl}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const csvText = await response.text();

      parseAndStoreCSV(csvText);
    } catch (error) {
      console.error("Error fetching cleaned CSV file:", error);
      tablePlaceholder.innerHTML =
        '<p style="color: red; padding: 20px;">Could not fetch cleaned data. Check if the server is running.</p>';
    }
  }

  // --- EVENT LISTENERS: UPLOAD and TAB SWITCHING ---

  if (fileInput) {
    fileArea.addEventListener("click", () => {
      if (!loadingContent || loadingContent.classList.contains("hidden")) {
        fileInput.click();
      }
    });

    fileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (file) {
        // Clear state and storage keys for a fresh upload
        fullCleanedData = [];
        dataTableGenerated = false;
        localStorage.removeItem("currentSearchTerm");
        localStorage.removeItem(DATA_STORAGE_KEY);

        if (uploadContent) uploadContent.classList.add("hidden");
        if (loadingContent) loadingContent.classList.remove("hidden");
        fileArea.style.cursor = "default";

        const formData = new FormData();
        formData.append("file", file);

        try {
          const response = await fetch(API_URL, {
            method: "POST",
            body: formData,
          });

          const result = await response.json();

          if (result.success) {
            localStorage.setItem(DATA_URL_KEY, result.cleaned_data_url);

            // CRITICAL FIX: Load data immediately after POST success
            // This fetches the data and populates the memory arrays.
            await loadDataTable();

            // 2. Switch the dashboard state and display metrics
            // NOTE: loadDataTable already updated metrics based on full data
            showAnalyticsState(result.metrics);
          } else {
            console.error("Server processing failed:", result.details);
            uploadContent.classList.remove("hidden");
            loadingContent.classList.add("hidden");
            fileArea.style.cursor = "pointer";
            console.error(
              `Error: File processing failed. Details: ${result.details}`
            );
          }
        } catch (error) {
          console.error("Network error during upload:", error);
          uploadContent.classList.remove("hidden");
          loadingContent.classList.add("hidden");
          fileArea.style.cursor = "pointer";
          console.error("Connection error: Could not reach Python server.");
        }
      }
    });
  }

  // Tab Switching Logic
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.getAttribute("data-tab");

      if (localStorage.getItem(DATA_LOADED_KEY) === "true") {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        if (analyticsContent) analyticsContent.classList.add("hidden-content");
        if (dataTableContent) dataTableContent.classList.add("hidden-content");
        if (predictionContent)
          predictionContent.classList.add("hidden-content");

        const targetContent = document.getElementById(tabName + "-content");
        if (targetContent) {
          targetContent.classList.remove("hidden-content");
        }

        if (tabName === "data-table") {
          loadDataTable();
        }
      } else {
        console.log("Please upload a CSV file first.");
      }
    });
  });

  // Initial attachment of filter button listeners
  document
    .getElementById("applyFilterButton")
    .addEventListener("click", applyMultiFilter);
  document
    .getElementById("resetFilterButton")
    .addEventListener("click", resetMultiFilters);

  // Initial attachment of the quick search listener
  const initialSearchInput = document.getElementById("tableSearchInput");
  if (initialSearchInput) {
    initialSearchInput.addEventListener("keyup", performGlobalSearch);
  }
});
