// Keeps every npm / pnpm / yarn / bun code group on the reader's package
// manager. Picking a tab switches the other groups of the page and is saved in
// localStorage, so later pages and visits open on the same tab.

const STORAGE_KEY = "vifx:package-manager";
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

function readChoice(): string | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value !== null && PACKAGE_MANAGERS.has(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function saveChoice(manager: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, manager);
  } catch {
    // Storage can be blocked (private browsing, site data off): the choice then
    // lasts for the current page only.
  }
}

/** The tab title of a code group input, such as "pnpm". */
function titleOf(input: HTMLInputElement): string | undefined {
  const label = input
    .closest(".vp-code-group")
    ?.querySelector(`label[for="${CSS.escape(input.id)}"]`);
  return label instanceof HTMLLabelElement ? label.dataset.title : undefined;
}

/**
 * Shows the input's tab the way VitePress does, without a click: a click would
 * also scroll the page to that group.
 */
function activate(input: HTMLInputElement): void {
  const group = input.closest(".vp-code-group");
  const blocks = group?.querySelector(".blocks");
  if (!group || !blocks) {
    return;
  }
  const index = Array.from(group.querySelectorAll(".tabs input")).indexOf(input);
  const next = blocks.children[index];
  if (index < 0 || !next) {
    return;
  }
  input.checked = true;
  for (const block of Array.from(blocks.children)) {
    block.classList.toggle("active", block === next);
  }
  window.dispatchEvent(new CustomEvent("vitepress:codeGroupTabActivate", { detail: next }));
}

/** Switches every code group that has a `manager` tab, except `source`'s. */
function showEverywhere(manager: string, source?: HTMLInputElement): void {
  for (const label of Array.from(document.querySelectorAll(".vp-code-group .tabs label"))) {
    if (!(label instanceof HTMLLabelElement) || label.dataset.title !== manager) {
      continue;
    }
    const input = document.getElementById(label.htmlFor);
    if (input instanceof HTMLInputElement && input !== source && !input.checked) {
      activate(input);
    }
  }
}

/** Puts the page's code groups on the saved package manager. */
export function applyStoredPackageManager(): void {
  const manager = readChoice();
  if (manager) {
    showEverywhere(manager);
  }
}

/** Saves the package manager the reader picks and applies it to the page. */
export function syncPackageManagerTabs(): void {
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.closest(".vp-code-group")) {
      return;
    }
    const manager = titleOf(input);
    if (!manager || !PACKAGE_MANAGERS.has(manager)) {
      return;
    }
    saveChoice(manager);
    showEverywhere(manager, input);
  });
}
