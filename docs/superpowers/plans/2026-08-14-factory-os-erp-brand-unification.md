# Factory OS ERP Brand Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ERPNext Factory OS theme display the shared cyan `F` identity and the formal name `Factory OS ERP` in Desk, login, preview, title, and favicon.

**Architecture:** Keep the change inside the existing Frappe theme app. CSS owns appearance; the existing theme JavaScript applies accessible brand markup to dynamic Frappe surfaces and installs the favicon without changing ERPNext internals.

**Tech Stack:** Frappe/ERPNext theme hooks, JavaScript, SCSS, Python unittest, static HTML preview

## Global Constraints

- Formal name is exactly `Factory OS ERP`.
- Mark is a `#00B8FF` rounded square with a bold uppercase `F` in `#09212A`.
- Do not modify DocTypes, permissions, workflows, routes, APIs, or database state.
- Target directory is not a Git repository; do not initialize Git or create a fake commit.

---

### Task 1: ERPNext dynamic branding and assets

**Files:**
- Create: `E:/6.Factory OS/Factory + ERP +MES/erpnext_factory_os_theme/factory_os_theme/public/images/factory-os-mark.svg`
- Modify: `E:/6.Factory OS/Factory + ERP +MES/erpnext_factory_os_theme/factory_os_theme/public/js/factory_os_theme.bundle.js`
- Modify: `E:/6.Factory OS/Factory + ERP +MES/erpnext_factory_os_theme/factory_os_theme/public/scss/factory_os_theme.scss`
- Modify: `E:/6.Factory OS/Factory + ERP +MES/erpnext_factory_os_theme/preview/erpnext-factory-os-preview.html`
- Test: `E:/6.Factory OS/Factory + ERP +MES/erpnext_factory_os_theme/tests/test_branding.py`

**Interfaces:**
- Consumes: Frappe's `.navbar .navbar-brand` and `.login-content .login-header .login-title` elements.
- Produces: `applyFactoryOsBrand()` and a `.factory-os-brand-mark`/`.factory-os-brand-name` DOM contract.

- [ ] **Step 1: Write the failing static contract test**

Create `tests/test_branding.py`:

```python
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class BrandingTest(unittest.TestCase):
    def test_factory_os_erp_brand_contract(self):
        js = (ROOT / "factory_os_theme/public/js/factory_os_theme.bundle.js").read_text(encoding="utf-8")
        scss = (ROOT / "factory_os_theme/public/scss/factory_os_theme.scss").read_text(encoding="utf-8")
        preview = (ROOT / "preview/erpnext-factory-os-preview.html").read_text(encoding="utf-8")
        mark = (ROOT / "factory_os_theme/public/images/factory-os-mark.svg").read_text(encoding="utf-8")

        self.assertIn("function applyFactoryOsBrand()", js)
        self.assertIn("Factory OS ERP", js)
        self.assertIn(".factory-os-brand-mark", scss)
        self.assertIn("Factory OS ERP", preview)
        self.assertIn('fill="#00B8FF"', mark)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
python -m unittest tests.test_branding -v
```

Expected: ERROR because the SVG asset does not exist.

- [ ] **Step 3: Add the shared SVG mark**

Create `factory_os_theme/public/images/factory-os-mark.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title>Factory OS</title>
  <rect width="64" height="64" rx="12" fill="#00B8FF"/>
  <text x="32" y="44" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="800" fill="#09212A">F</text>
</svg>
```

- [ ] **Step 4: Add dynamic Frappe brand application**

Extend the existing `frappe.ready` callback to call `applyFactoryOsBrand()` before `injectFactoryOsFlowStrip()`. Add:

```js
function applyFactoryOsBrand() {
	const brand = document.querySelector(".navbar .navbar-brand");
	if (brand && brand.dataset.factoryOsBranded !== "true") {
		brand.dataset.factoryOsBranded = "true";
		brand.setAttribute("aria-label", "Factory OS ERP");
		brand.innerHTML =
			'<span class="factory-os-brand-mark" aria-hidden="true">F</span>' +
			'<span class="factory-os-brand-name">Factory OS ERP</span>';
	}

	const loginTitle = document.querySelector(
		".login-content .login-header .login-title"
	);
	if (loginTitle && loginTitle.textContent !== "Factory OS ERP") {
		loginTitle.textContent = "Factory OS ERP";
	}

	document.title = document.title.replace(/ERPNext/g, "Factory OS ERP");
	let favicon = document.querySelector('link[rel="icon"]');
	if (!favicon) {
		favicon = document.createElement("link");
		favicon.rel = "icon";
		document.head.appendChild(favicon);
	}
	favicon.type = "image/svg+xml";
	favicon.href = "/assets/factory_os_theme/images/factory-os-mark.svg";
}
```

Use this exact `frappe.ready` body so Frappe route changes cannot restore the old header without causing an observer loop:

```js
frappe.ready(() => {
	applyFactoryOsBrand();
	if (frappe.boot?.desk) {
		document.body.classList.add("factory-os-theme");
		injectFactoryOsFlowStrip();
	}

	const observer = new MutationObserver(() => applyFactoryOsBrand());
	observer.observe(document.body, { childList: true, subtree: true });
});
```

Do not mutate any other elements.

- [ ] **Step 5: Style the shared mark**

Add to the existing navbar brand section in `factory_os_theme.scss`:

```scss
.factory-os-brand-mark {
	display: inline-grid;
	place-items: center;
	width: 32px;
	height: 32px;
	border-radius: 7px;
	color: #09212a;
	background: #00b8ff;
	font-family: Arial, Helvetica, sans-serif;
	font-size: 17px;
	font-weight: 800;
	line-height: 1;
}

.factory-os-brand-name {
	font-weight: 800;
}
```

- [ ] **Step 6: Align the static preview**

In `preview/erpnext-factory-os-preview.html`, set `<title>Factory OS ERP 视觉预览</title>`, render `F` inside `.navbar-brand-img`, and retain the visible name `Factory OS ERP` in both Desk and login examples. Update `.navbar-brand-img` to the same colors and `7px` radius.

- [ ] **Step 7: Verify the theme contract and SCSS build inputs**

Run:

```powershell
python -m unittest tests.test_branding -v
python -m compileall factory_os_theme
```

Expected: one branding test PASS and compileall exits 0.

- [ ] **Step 8: Verify in ERPNext**

Build/install the existing theme through its documented Bench workflow, then inspect ERPNext login and Desk. Verify the same `F` mark, `Factory OS ERP`, favicon, no duplicated navbar brand, and no change to ERPNext navigation or forms.
