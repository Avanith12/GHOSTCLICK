// The Automation Challenges and their verifier. A challenge passes only when the stored demo state
// shows the work was really done (what is in the cart, what was saved, exported, or submitted),
// never because an agent said it finished.
import { EMPLOYEES, PRODUCTS } from './data.js';
import { topDepartment } from './metrics.js';

const person = (name) => EMPLOYEES.find((item) => item.name === name);
const product = (name) => PRODUCTS.find((item) => item.name === name);
const events = (state, type) => state.events.filter((event) => event.type === type);
const inCart = (state, item) => state.cart.some((line) => line.id === item.id);
const viewed = (state, item) => events(state, 'view-product').some((event) => event.data.id === item.id);
const lastApplication = (state, match) => [...state.applications].reverse().find(match);

const jordan = person('Jordan Lee');
const grace = person('Grace Hopper');
const laptops = PRODUCTS.filter((item) => item.category === 'Laptops' && item.price < 1200).sort((left, right) => left.price - right.price);
const cheapestLaptop = laptops.find((item) => item.stock > 0);
const monitors = PRODUCTS.filter((item) => item.category === 'Monitors').sort((left, right) => left.price - right.price).slice(0, 2);
const roomierMonitor = [...monitors].sort((left, right) => right.stock - left.stock)[0];
const cheapestPhone = PRODUCTS.filter((item) => item.category === 'Phones' && item.stock > 0).sort((left, right) => left.price - right.price)[0];
const best30 = topDepartment('30');

export const CHALLENGES = [
  {
    id: 'find-person',
    title: 'Find a colleague',
    difficulty: 'Easy',
    instruction: 'Open the Employee Directory, find Jordan Lee, and open their profile. What department are they in?',
    outcome: `Jordan Lee's profile or details are open. Answer: ${jordan.department}.`,
    pages: ['Employee Directory', 'Employee profile'],
    actions: 3,
    features: 'Search, look-alike names (Jordan Leigh, Jordana Lewis), dynamic results',
    check: (state) => [['Jordan Lee (not a look-alike) was opened', events(state, 'view-employee').some((event) => event.data.id === jordan.id)]],
  },
  {
    id: 'dark-mode',
    title: 'Turn on dark mode',
    difficulty: 'Easy',
    instruction: 'Go to Settings, switch the theme to dark mode, and save.',
    outcome: 'The saved theme is dark and the whole demo turns dark.',
    pages: ['Settings'],
    actions: 4,
    features: 'Nested settings navigation, radio buttons, save bar',
    check: (state) => [
      ['The saved theme is dark', state.settings.theme === 'dark'],
      ['Settings were saved with dark mode', events(state, 'settings-saved').some((event) => event.data.theme === 'dark')],
    ],
  },
  {
    id: 'add-laptop',
    title: 'Add a product to the cart',
    difficulty: 'Easy',
    instruction: 'In Product Inventory, add one Lumen Air laptop to the cart.',
    outcome: 'The cart holds a Lumen Air.',
    pages: ['Product Inventory'],
    actions: 3,
    features: 'Category chips, many similar "Add to cart" buttons',
    check: (state) => [['A Lumen Air is in the cart', inCart(state, product('Lumen Air'))]],
  },
  {
    id: 'engineering-export',
    title: 'Export a filtered list',
    difficulty: 'Medium',
    instruction: 'Go to the Employee Directory, show only employees in Engineering, sort them by last name, and export their information as CSV.',
    outcome: 'A CSV of every Engineering employee, A to Z by last name, is downloaded.',
    pages: ['Employee Directory'],
    actions: 4,
    features: 'Dropdown filters, sorting, export',
    check: (state) => {
      const exports = events(state, 'export').filter((event) => event.data.page === 'directory');
      const good = exports.find((event) => event.data.department === 'Engineering' && event.data.sort === 'lastName' && event.data.dir === 'asc' && !event.data.query && !event.data.location);
      return [
        ['The directory was exported', exports.length > 0],
        ['Only Engineering, sorted by last name A to Z, without other filters', Boolean(good)],
        ['The export was a CSV file', Boolean(good && good.data.format === 'csv')],
      ];
    },
  },
  {
    id: 'settings-automation',
    title: 'Change several settings',
    difficulty: 'Medium',
    instruction: 'Switch the dashboard to dark mode, enable email notifications, change the display density to Compact, and save the settings.',
    outcome: 'Saved settings: dark theme, email notifications on, Compact density.',
    pages: ['Settings'],
    actions: 8,
    features: 'Toggle switches, a custom dropdown whose options are hidden until opened, multiple panels',
    check: (state) => [
      ['Theme saved as dark', state.settings.theme === 'dark'],
      ['Email notifications saved as on', state.settings.notifications.email === true],
      ['Display density saved as Compact', state.settings.density === 'Compact'],
    ],
  },
  {
    id: 'cheap-laptop',
    title: 'Shop for the cheapest laptop',
    difficulty: 'Medium',
    instruction: 'Find laptops under $1,200, sort them by price from low to high, open the details of the three cheapest, and add the cheapest one that is in stock to the cart.',
    outcome: `${laptops.slice(0, 3).map((item) => item.name).join(', ')} were inspected; ${cheapestLaptop.name} is in the cart (${laptops[0].name} is sold out).`,
    pages: ['Product Inventory', 'Product details'],
    actions: 9,
    features: 'Price filter, sorting, cards that move after filtering, out-of-stock handling',
    check: (state) => [
      ...laptops.slice(0, 3).map((item) => [`Opened the details of ${item.name}`, viewed(state, item)]),
      [`${cheapestLaptop.name} is in the cart`, inCart(state, cheapestLaptop)],
      ['No pricier laptop was added instead', !laptops.slice(1).filter((item) => item !== cheapestLaptop).some((item) => inCart(state, item))],
    ],
  },
  {
    id: 'application',
    title: 'Complete a job application',
    difficulty: 'Medium',
    instruction:
      'Open the Job Application Portal and apply for the Data Analyst role as Avery Quinn (avery.quinn@example.com, phone 555-010-4477, located Remote), full-time, starting 2026-11-02, with 4 years of experience in SQL and Python. Review everything, then submit.',
    outcome: 'An application from Avery Quinn for Data Analyst with exactly these details is submitted.',
    pages: ['Job Applications'],
    actions: 18,
    features: 'Multi-step form, radios, checkboxes, date input, validation, review step',
    check: (state) => {
      const app = lastApplication(state, (item) => item.lastName.toLowerCase() === 'quinn');
      return [
        ['Application from Avery Quinn submitted', Boolean(app && app.firstName.toLowerCase() === 'avery')],
        ['Email and phone are correct', Boolean(app && app.email.toLowerCase() === 'avery.quinn@example.com' && app.phone === '555-010-4477')],
        ['Data Analyst, Remote, full-time, starting 2026-11-02', Boolean(app && app.position === 'Data Analyst' && app.location === 'Remote' && app.employmentType === 'Full-time' && app.startDate === '2026-11-02')],
        ['4 years with SQL and Python', Boolean(app && Number(app.years) === 4 && app.skills.includes('SQL') && app.skills.includes('Python'))],
      ];
    },
  },
  {
    id: 'analytics-report',
    title: 'Analyze and export a report',
    difficulty: 'Hard',
    instruction: 'Navigate to Analytics, select the last 30 days, find the highest-performing department, generate the report, and export it as CSV.',
    outcome: `The 30-day report is exported. Answer: ${best30} (over 90 days a different department leads, so the range matters).`,
    pages: ['Analytics & Reports'],
    actions: 5,
    features: 'Date filters, sortable tables, report generation, export',
    check: (state) => [
      ['A report was generated for the last 30 days', events(state, 'report-generated').some((event) => event.data.range === '30')],
      ['The 30-day report was exported as CSV', events(state, 'export').some((event) => event.data.page === 'analytics' && event.data.range === '30' && event.data.format === 'csv')],
    ],
  },
  {
    id: 'cross-page',
    title: 'Connect two pages',
    difficulty: 'Hard',
    instruction: "Find the employee named Jordan Lee, open their profile, identify their department, then go to Analytics and open that department's details for the last 30 days.",
    outcome: `${jordan.department} details are open in Analytics for the last 30 days, after viewing Jordan Lee.`,
    pages: ['Employee Directory', 'Employee profile', 'Analytics & Reports'],
    actions: 6,
    features: 'Multi-page workflow, carrying information between pages, collapsible sections',
    check: (state) => {
      const seen = state.events.findIndex((event) => event.type === 'view-employee' && event.data.id === jordan.id);
      const opened = state.events.findIndex((event, index) => index > seen && event.type === 'expand-department' && event.data.department === jordan.department && event.data.range === '30');
      return [
        ["Jordan Lee's profile was viewed", seen >= 0],
        [`Afterwards, ${jordan.department} details were opened in Analytics for the last 30 days`, seen >= 0 && opened > seen],
      ];
    },
  },
  {
    id: 'two-tabs',
    title: 'Compare in new tabs',
    difficulty: 'Hard',
    instruction: 'In Product Inventory, open the two cheapest monitors in new tabs, compare how many units each has in stock, and add the one with more units in stock to the cart.',
    outcome: `${monitors.map((item) => item.name).join(' and ')} opened in their own tabs; ${roomierMonitor.name} is in the cart.`,
    pages: ['Product Inventory', 'Product details (two tabs)'],
    actions: 7,
    features: 'Multiple tabs, switching tabs, comparing data across pages',
    check: (state) => {
      const fresh = (item) => events(state, 'view-product').some((event) => event.data.id === item.id && event.data.freshTab);
      return [
        ...monitors.map((item) => [`${item.name} was opened in its own tab`, fresh(item)]),
        [`${roomierMonitor.name} (more stock) is in the cart`, inCart(state, roomierMonitor)],
        ['The other monitor was not added', !monitors.filter((item) => item !== roomierMonitor).some((item) => inCart(state, item))],
      ];
    },
  },
  {
    id: 'self-healing',
    title: 'Replay after a redesign',
    difficulty: 'Hard',
    instruction:
      'Record the classic advising form once (Workflows → Record this page). Then choose "Simulate a redesigned button" and replay the workflow for Grace Hopper, ID 55667788, grace.hopper@northwind.example.',
    outcome: 'The request is submitted for Grace Hopper even though Continue was renamed to Next and a Cancel button appeared.',
    pages: ['Advising form (classic)'],
    actions: 7,
    features: 'Recording, replay with new values, self-repair, avoiding Cancel',
    check: (state) => {
      const sent = events(state, 'advising-submitted').filter((event) => /grace hopper/i.test(event.data.studentName));
      return [
        ['A request was submitted for Grace Hopper', sent.length > 0],
        ['It went through on the redesigned page', sent.some((event) => event.data.redesigned)],
      ];
    },
  },
  {
    id: 'checkout',
    title: 'Buy with approval',
    difficulty: 'Expert',
    instruction: 'Add the cheapest phone that is in stock to the cart, then check out and place the demo order. Ask me before placing it.',
    outcome: `An order containing ${cheapestPhone.name} is placed (Pulse X is cheaper but sold out). The agent asks before Place order.`,
    pages: ['Product Inventory', 'Cart'],
    actions: 6,
    features: 'Conditional choice, modal dialogs, approval before a consequential action',
    check: (state) => [
      [`An order containing ${cheapestPhone.name} was placed`, events(state, 'order-placed').some((event) => event.data.items.some((item) => item.id === cheapestPhone.id))],
      ['No other phone was ordered', !events(state, 'order-placed').some((event) => event.data.items.some((item) => item.id !== cheapestPhone.id && PRODUCTS.find((p) => p.id === item.id)?.category === 'Phones'))],
    ],
  },
  {
    id: 'validation',
    title: 'Recover from a form error',
    difficulty: 'Expert',
    instruction:
      'Apply for the Support Specialist role as Sam Rivera, sam.rivera@example.com, phone 5550107788, located in Toronto, contract, starting 2026-12-01, 2 years of experience in Customer service. If the form rejects a value, fix it and continue.',
    outcome: 'The phone is rejected until it is written as 555-010-7788; the application is then submitted.',
    pages: ['Job Applications'],
    actions: 18,
    features: 'Validation errors, reading error messages, retrying with corrected input',
    check: (state) => {
      const app = lastApplication(state, (item) => item.lastName.toLowerCase() === 'rivera');
      return [
        ['Application from Sam Rivera submitted', Boolean(app && app.firstName.toLowerCase() === 'sam')],
        ['Phone corrected to 555-010-7788', app?.phone === '555-010-7788'],
        ['Support Specialist, Toronto, contract', Boolean(app && app.position === 'Support Specialist' && app.location === 'Toronto' && app.employmentType === 'Contract')],
      ];
    },
  },
];

/** Grade every challenge against the stored state. */
export function grade(state) {
  return CHALLENGES.map((challenge) => {
    const criteria = challenge.check(state).map(([text, met]) => ({ text, met: Boolean(met) }));
    return { id: challenge.id, pass: criteria.every((item) => item.met), criteria };
  });
}

export const EXPECTED = { jordanDepartment: jordan.department, best30, cheapestLaptop: cheapestLaptop.name, roomierMonitor: roomierMonitor.name, cheapestPhone: cheapestPhone.name, grace: grace.name };
