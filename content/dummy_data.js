/**
 * SnapCraft Dummy Data & Anonymizer Engine
 * 
 * Replaces sensitive customer data (Names, US Phone Numbers, Email Addresses)
 * in-flight during capture with realistic synthetic dummy data, then restores
 * original DOM values immediately after capture.
 */

window.SnapCraftDummyData = (function () {

  // --- Curated Realistic Names Pool (Common First Names) ---
  const FIRST_NAMES = [
    'Alex', 'Jordan', 'Taylor', 'Morgan', 'Sam', 'Chris', 'Pat', 'Casey', 'Jamie', 'Cameron',
    'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
    'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
    'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa',
    'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
    'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
    'Kenneth', 'Dorothy', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa',
    'Edward', 'Deborah', 'Ronald', 'Stephanie', 'Timothy', 'Rebecca', 'Jason', 'Sharon',
    'Jeffrey', 'Laura', 'Ryan', 'Cynthia', 'Jacob', 'Kathleen', 'Gary', 'Amy',
    'Nicholas', 'Shirley', 'Eric', 'Angela', 'Jonathan', 'Helen', 'Stephen', 'Anna',
    'Larry', 'Brenda', 'Justin', 'Pamela', 'Scott', 'Nicole', 'Brandon', 'Emma',
    'Benjamin', 'Samantha', 'Samuel', 'Katherine', 'Gregory', 'Christine', 'Frank', 'Debra',
    'Alexander', 'Rachel', 'Raymond', 'Catherine', 'Patrick', 'Carolyn', 'Jack', 'Janet',
    'Dennis', 'Ruth', 'Jerry', 'Maria', 'Tyler', 'Heather', 'Aaron', 'Diane',
    'Jose', 'Virginia', 'Adam', 'Julie', 'Nathan', 'Joyce', 'Henry', 'Victoria',
    'Zachary', 'Olivia', 'Douglas', 'Kelly', 'Peter', 'Christina', 'Kyle', 'Lauren',
    'Noah', 'Liam', 'Oliver', 'Elijah', 'Lucas', 'Mason', 'Ethan', 'Logan',
    'Aiden', 'Jackson', 'Carter', 'Owen', 'Wyatt', 'Luke', 'Asher', 'Grayson',
    'Leo', 'Jayden', 'Gabriel', 'Julian', 'Mateo', 'Jaxon', 'Lincoln',
    'Theodore', 'Caleb', 'Adrian', 'Christian', 'Colton', 'Elias', 'Eli', 'Landon',
    'Nolan', 'Connor', 'Santiago', 'Jeremiah', 'Ezekiel', 'Angel', 'Roman', 'Miles',
    'Ian', 'Carson', 'Axel', 'Dominic', 'Leonardo', 'Luca', 'Austin', 'Xavier',
    'Everett', 'Declan', 'Evan', 'Parker', 'Wesley', 'Kai', 'Harrison', 'Cole',
    'Sophia', 'Isabella', 'Mia', 'Harper', 'Evelyn', 'Abigail', 'Ella', 'Camila',
    'Luna', 'Sofia', 'Avery', 'Mila', 'Aria', 'Scarlett', 'Penelope', 'Layla',
    'Chloe', 'Madison', 'Eleanor', 'Grace', 'Nora', 'Riley', 'Zoey', 'Hannah',
    'Hazel', 'Lily', 'Ellie', 'Violet', 'Lillian', 'Zoe', 'Stella', 'Aurora',
    'Natalie', 'Emilia', 'Leah', 'Aubrey', 'Willow', 'Addison', 'Lucy', 'Audrey',
    'Bella', 'Brooklyn', 'Claire', 'Skylar', 'Naomi', 'Elena', 'Caroline', 'Maya',
    'Ruby', 'Kennedy', 'Ivy', 'Ariana', 'Alice', 'Madelyn', 'Allison', 'Gianna',
    'Autumn', 'Quinn', 'Eva', 'Piper', 'Sadie', 'Josephine', 'Lydia', 'Clara',
    'Vivian', 'Madeline', 'Peyton', 'Julia', 'Rylee', 'Marcus', 'Trevor', 'Sean'
  ];

  // Lookup set for strict first-name validation (case-insensitive)
  const FIRST_NAMES_SET = new Set(FIRST_NAMES.map(n => n.toLowerCase()));

  const LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
    'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
    'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
    'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
    'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
    'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
    'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy',
    'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey',
    'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson',
    'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza',
    'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers',
    'Long', 'Ross', 'Foster', 'Jimenez', 'Powell', 'Jenkins', 'Perry', 'Russell',
    'Sullivan', 'Bell', 'Coleman', 'Butler', 'Henderson', 'Barnes', 'Gonzales', 'Fisher'
  ];

  // Common UI / English words to exclude from name matching (prevents rewriting buttons, navigation, headers)
  const UI_STOP_WORDS = new Set([
    'View', 'Edit', 'Delete', 'Update', 'Remove', 'Add', 'Create', 'New', 'Cancel', 'Save',
    'Submit', 'Order', 'Orders', 'Invoice', 'Invoices', 'Account', 'Accounts', 'Profile',
    'Settings', 'Dashboard', 'Details', 'Overview', 'Status', 'Active', 'Pending', 'Completed',
    'Total', 'Subtotal', 'Tax', 'Amount', 'Balance', 'Due', 'Paid', 'Payment', 'Method',
    'Credit', 'Debit', 'Card', 'Number', 'Date', 'Time', 'History', 'Log', 'Activity',
    'Customer', 'Client', 'User', 'Admin', 'Manager', 'Member', 'Team', 'Support', 'Help',
    'Contact', 'Info', 'Information', 'Address', 'Shipping', 'Billing', 'Street', 'City',
    'State', 'Zip', 'Country', 'Phone', 'Telephone', 'Email', 'Website', 'Search', 'Filter',
    'Sort', 'Export', 'Import', 'Download', 'Upload', 'Print', 'Share', 'Copy', 'Paste',
    'Next', 'Previous', 'Back', 'Forward', 'First', 'Last', 'Page', 'Item', 'Items',
    'Product', 'Products', 'Service', 'Services', 'Price', 'Quantity', 'Qty', 'Discount',
    'Cart', 'Checkout', 'Summary', 'Report', 'Reports', 'Analytics', 'Monthly', 'Annual',
    'Yearly', 'Daily', 'Weekly', 'Welcome', 'Sign', 'Log', 'Out', 'Register', 'Subscribe',
    'Learn', 'More', 'Click', 'Here', 'Read', 'Documentation', 'Guide', 'Terms', 'Privacy',
    'Policy', 'Copyright', 'Reserved', 'Rights', 'All', 'True', 'False', 'Yes', 'No',
    'High', 'Medium', 'Low', 'Priority', 'Category', 'Type', 'Description', 'Notes',
    'Action', 'Actions', 'Select', 'Options', 'Custom', 'Default', 'Standard', 'Premium',
    'Call', 'Meet', 'Notify', 'Message', 'Chat', 'Review', 'Check', 'Manage', 'Send', 'Receive',
    'Senior', 'Junior', 'Director', 'Chief', 'Officer', 'Associate', 'President', 'Lead', 'Staff',
    'Administrator', 'Developer', 'Engineer', 'Specialist', 'Analyst', 'Coordinator', 'Verified',
    // Domain & UI specific exclusions:
    'None', 'Scheduled', 'Schedule', 'Draft', 'Music', 'Band', 'Lessons', 'Lesson', 'Rental',
    'Rentals', 'Instrument', 'Instruments', 'Charges', 'Charge', 'Rock', 'School', 'Class',
    'Classes', 'Session', 'Sessions', 'Program', 'Programs', 'Package', 'Plan', 'Plans',
    'Subscription', 'Subscriptions', 'Course', 'Courses', 'Practice', 'Rehearsal', 'Paused',
    'Template', 'Templates', 'Drafts', 'Transaction', 'Transactions', 'Fee', 'Fees'
  ].map(s => s.toLowerCase()));

  // Column header / container keywords that indicate non-name content
  const NON_NAME_COLUMN_REGEX = /(?:subscription|service|plan|package|product|draft|date|time|schedule|scheduled|status|state|amount|cost|price|fee|balance|total|sku|code|quantity|qty)/i;

  // Realistic US Area Codes
  const AREA_CODES = ['206', '212', '310', '312', '415', '503', '512', '617', '650', '702', '718', '818', '917'];

  /**
   * Helper: pick random element from array
   */
  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Helper: random integer between min and max inclusive
   */
  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Format-preserving US Phone Number generator
   */
  function generateDummyPhone(originalMatch) {
    const areaCode = pickRandom(AREA_CODES);
    // Official reserved fictional exchange range: 555-0100 through 555-0199
    const lineNumber = String(randomInt(100, 199)).padStart(4, '0');

    // Preserve formatting based on original match characteristics
    const hasParens = originalMatch.includes('(') && originalMatch.includes(')');
    const hasDashes = originalMatch.includes('-');
    const hasDots = originalMatch.includes('.');
    const hasCountryCode = originalMatch.startsWith('+1') || originalMatch.startsWith('1-') || originalMatch.startsWith('1 ');

    let result = '';
    if (hasParens) {
      const space = originalMatch.includes(') ') ? ' ' : '';
      result = `(${areaCode})${space}555-${lineNumber}`;
    } else if (hasDots) {
      result = `${areaCode}.555.${lineNumber}`;
    } else if (hasDashes) {
      result = `${areaCode}-555-${lineNumber}`;
    } else {
      result = `(${areaCode}) 555-${lineNumber}`;
    }

    if (hasCountryCode) {
      if (originalMatch.startsWith('+1')) {
        result = `+1 ${result}`;
      } else {
        result = `1-${result}`;
      }
    }

    return result;
  }

  /**
   * Format-preserving Email Address generator
   */
  function generateDummyEmail(dummyName) {
    const domains = ['example.com', 'example.org', 'example.net'];
    const domain = pickRandom(domains);

    if (dummyName) {
      const parts = dummyName.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
      if (parts.length >= 2) {
        return `${parts[0]}.${parts[parts.length - 1]}@${domain}`;
      } else if (parts.length === 1 && parts[0]) {
        return `${parts[0]}@${domain}`;
      }
    }

    const first = pickRandom(FIRST_NAMES).toLowerCase();
    const last = pickRandom(LAST_NAMES).toLowerCase();
    return `${first}.${last}@${domain}`;
  }

  /**
   * Realistic Name generator
   */
  function generateDummyName() {
    return `${pickRandom(FIRST_NAMES)} ${pickRandom(LAST_NAMES)}`;
  }

  /**
   * Inspects the DOM context to determine if the node belongs to an excluded column
   * (e.g. "Subscription", "Next Draft", "Status", "Date", etc.)
   */
  function isExcludedFromNamesContext(node) {
    if (!node) return false;
    let elem = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!elem) return false;

    // 1. Check if node is inside a table cell and check the corresponding column header
    const cell = elem.closest('td, th, [role="cell"], [role="gridcell"]');
    if (cell) {
      if (cell.tagName.toLowerCase() === 'th' || cell.getAttribute('role') === 'columnheader') {
        return true; // Never alter table column headers
      }

      const table = cell.closest('table');
      if (table && cell.cellIndex !== undefined) {
        const colIndex = cell.cellIndex;
        const ths = table.querySelectorAll('thead th, tr:first-child th');
        if (ths && ths[colIndex]) {
          const headerText = ths[colIndex].textContent || '';
          if (NON_NAME_COLUMN_REGEX.test(headerText)) {
            return true;
          }
        }
      }
    }

    // 2. Check classes, aria-labels, and data-attributes up ancestor tree
    let curr = elem;
    let depth = 0;
    while (curr && depth < 5 && curr !== document.body) {
      const classStr = (curr.className && typeof curr.className === 'string') ? curr.className : '';
      const idStr = curr.id || '';
      const aria = curr.getAttribute('aria-label') || '';
      const testid = curr.getAttribute('data-testid') || '';
      const colAttr = curr.getAttribute('data-column') || curr.getAttribute('data-field') || '';

      const combined = `${classStr} ${idStr} ${aria} ${testid} ${colAttr}`;
      if (NON_NAME_COLUMN_REGEX.test(combined)) {
        return true;
      }
      curr = curr.parentElement;
      depth++;
    }

    return false;
  }

  /**
   * Session Context to maintain consistency across the capture
   */
  class AnonymizeSession {
    constructor(options = {}) {
      this.options = {
        names: options.names !== false,
        phones: options.phones !== false,
        emails: options.emails !== false
      };

      // Mappings to ensure identical original values map to identical dummy values
      this.phoneMap = new Map();
      this.emailMap = new Map();
      this.nameMap = new Map();
      this.lastAssignedName = null;

      // Regex Patterns
      // US Phone Numbers: matches (555) 555-1212, (555)555-1212, 555-555-1212, 555.555.1212, +1 (555) 555-1212, etc.
      this.phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;

      // Standard Email Addresses
      this.emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

      // 2 or 3 Capitalized Words for Names (with optional middle initial): e.g. "Sarah Jenkins", "Sarah M. Jenkins"
      this.nameRegex = /\b([A-Z][a-z]{1,20}(?:\s+(?:[A-Z]\.?\s+)?[A-Z][a-z]{1,20}){1,2})\b/g;
    }

    transformPhone(match) {
      if (!this.options.phones) return match;
      if (!this.phoneMap.has(match)) {
        this.phoneMap.set(match, generateDummyPhone(match));
      }
      return this.phoneMap.get(match);
    }

    transformEmail(match) {
      if (!this.options.emails) return match;
      if (!this.emailMap.has(match)) {
        this.emailMap.set(match, generateDummyEmail(this.lastAssignedName));
      }
      return this.emailMap.get(match);
    }

    transformName(match) {
      if (!this.options.names) return match;
      let tokens = match.trim().split(/\s+/);
      let prefix = '';

      // If the match starts with a common UI action verb/stop-word (e.g. "Contact Sarah Jenkins")
      if (tokens.length >= 3 && UI_STOP_WORDS.has(tokens[0].toLowerCase())) {
        prefix = tokens[0] + ' ';
        tokens = tokens.slice(1);
      }

      if (tokens.length < 2) {
        return match;
      }

      // First-Name Anchor: The first token MUST be a recognized first name
      const firstLower = tokens[0].toLowerCase();
      if (!FIRST_NAMES_SET.has(firstLower)) {
        return match; // Reject (e.g. "Music Lessons", "Band Instrument", "None Scheduled")
      }

      // Check if any candidate token is an excluded UI stop-word
      for (const token of tokens) {
        const clean = token.replace(/\.$/, '').toLowerCase();
        if (UI_STOP_WORDS.has(clean)) {
          return match;
        }
      }

      const candidateKey = tokens.join(' ');
      if (!this.nameMap.has(candidateKey)) {
        const dummy = generateDummyName();
        this.nameMap.set(candidateKey, dummy);
        this.lastAssignedName = dummy;
      }

      return prefix + this.nameMap.get(candidateKey);
    }

    /**
     * Sanitizes a single string containing potential names, emails, and phone numbers
     * @param {string} str - Target text to sanitize
     * @param {boolean} isNameAllowed - Whether person name replacement is permitted in this DOM context
     */
    sanitizeText(str, isNameAllowed = true) {
      if (!str || typeof str !== 'string') return str;

      let result = str;

      // Step 1: Replace Emails first (to prevent parts of emails matching name/phone rules)
      if (this.options.emails) {
        result = result.replace(this.emailRegex, (m) => this.transformEmail(m));
      }

      // Step 2: Replace Phone Numbers
      if (this.options.phones) {
        result = result.replace(this.phoneRegex, (m) => this.transformPhone(m));
      }

      // Step 3: Replace Names (only if enabled and permitted in this context)
      if (this.options.names && isNameAllowed) {
        result = result.replace(this.nameRegex, (m) => this.transformName(m));
      }

      return result;
    }
  }

  /**
   * Applies dummy data in-flight across the specified DOM root element.
   * Returns a restoration handle with a .restore() method.
   * 
   * @param {HTMLElement} rootElement - Target element or document.body
   * @param {Object} options - { names: true, phones: true, emails: true }
   * @returns {Object} { restore: () => void }
   */
  function apply(rootElement, options = {}) {
    if (!rootElement) return { restore: () => {} };

    const session = new AnonymizeSession(options);
    const restorations = [];

    // Walk all nodes under rootElement
    const walker = document.createTreeWalker(
      rootElement,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function (node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            // Don't modify script, style, SVG vector internals, or SnapCraft UI overlays
            if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path') {
              return NodeFilter.FILTER_REJECT;
            }
            if (node.id && node.id.startsWith('snapcraft-')) {
              return NodeFilter.FILTER_REJECT;
            }
            if (node.classList && (node.classList.contains('snapcraft-ignore') || node.classList.contains('snapcraft-ui'))) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let currentNode = walker.currentNode;
    while (currentNode) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const origText = currentNode.nodeValue;
        if (origText && origText.trim().length > 0) {
          const isNameAllowed = !isExcludedFromNamesContext(currentNode);
          const sanitized = session.sanitizeText(origText, isNameAllowed);
          if (sanitized !== origText) {
            restorations.push({
              type: 'text',
              node: currentNode,
              original: origText
            });
            currentNode.nodeValue = sanitized;
          }
        }
      } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
        const tag = currentNode.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          const isNameAllowed = !isExcludedFromNamesContext(currentNode);
          // Handle input/textarea values
          if (currentNode.value && currentNode.value.trim().length > 0) {
            const origVal = currentNode.value;
            const sanitizedVal = session.sanitizeText(origVal, isNameAllowed);
            if (sanitizedVal !== origVal) {
              restorations.push({
                type: 'input',
                node: currentNode,
                original: origVal
              });
              currentNode.value = sanitizedVal;
            }
          }

          // Also sanitize placeholder text if present
          const placeholder = currentNode.getAttribute('placeholder');
          if (placeholder && placeholder.trim().length > 0) {
            const sanitizedPh = session.sanitizeText(placeholder, isNameAllowed);
            if (sanitizedPh !== placeholder) {
              restorations.push({
                type: 'placeholder',
                node: currentNode,
                original: placeholder
              });
              currentNode.setAttribute('placeholder', sanitizedPh);
            }
          }
        }
      }
      currentNode = walker.nextNode();
    }

    return {
      count: restorations.length,
      restore: function () {
        for (let i = restorations.length - 1; i >= 0; i--) {
          const item = restorations[i];
          try {
            if (item.type === 'text') {
              item.node.nodeValue = item.original;
            } else if (item.type === 'input') {
              item.node.value = item.original;
            } else if (item.type === 'placeholder') {
              item.node.setAttribute('placeholder', item.original);
            }
          } catch (e) {
            console.warn('[SnapCraft] Could not restore node:', e);
          }
        }
      }
    };
  }

  return {
    apply,
    generateDummyName,
    generateDummyPhone,
    generateDummyEmail
  };

})();
