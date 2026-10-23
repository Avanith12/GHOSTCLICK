// Seeded, deterministic demo data for Northwind Works. Every visitor sees exactly the same records,
// so the Automation Challenges can be repeated and verified. Nothing here is real.

/** Small seeded PRNG (mulberry32) so "random" data is identical on every load. */
export function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The demo's fixed "today", so date filters always cover the same data. */
export const TODAY = '2026-10-01';

export const DEPARTMENTS = ['Engineering', 'Sales', 'Marketing', 'Finance', 'Operations', 'Support', 'People'];
export const LOCATIONS = ['Seattle', 'Austin', 'Toronto', 'London', 'Remote'];

const TITLES = {
  Engineering: ['Software Engineer', 'Senior Software Engineer', 'Staff Engineer', 'Engineering Manager', 'QA Engineer'],
  Sales: ['Account Executive', 'Sales Manager', 'Sales Development Rep', 'Solutions Consultant'],
  Marketing: ['Content Strategist', 'Marketing Manager', 'Brand Designer', 'Growth Analyst'],
  Finance: ['Financial Analyst', 'Controller', 'Accountant', 'Payroll Specialist'],
  Operations: ['Operations Manager', 'Logistics Coordinator', 'Program Manager', 'Facilities Lead'],
  Support: ['Support Specialist', 'Support Team Lead', 'Customer Success Manager'],
  People: ['Recruiter', 'People Partner', 'HR Generalist'],
};

// Hand-picked people the challenges rely on, including look-alike names on purpose.
const FIXED = [
  ['Jordan', 'Lee', 'Operations', 'Operations Manager', 'Austin'],
  ['Jordan', 'Leigh', 'Sales', 'Account Executive', 'London'],
  ['Jordana', 'Lewis', 'Marketing', 'Brand Designer', 'Toronto'],
  ['Grace', 'Hopper', 'Engineering', 'Staff Engineer', 'Seattle'],
  ['Ada', 'Lovelace', 'Engineering', 'Engineering Manager', 'London'],
  ['Alan', 'Turing', 'Engineering', 'Senior Software Engineer', 'Remote'],
  ['Katherine', 'Johnson', 'Finance', 'Controller', 'Austin'],
  ['Margaret', 'Hamilton', 'Engineering', 'QA Engineer', 'Seattle'],
];
const FIRST = ['Avery', 'Blake', 'Casey', 'Dana', 'Elliot', 'Frankie', 'Harper', 'Indigo', 'Jamie', 'Kai', 'Logan', 'Morgan', 'Noor', 'Oakley', 'Parker', 'Quinn', 'Riley', 'Sasha', 'Taylor', 'Uma', 'Val', 'Wren', 'Yuri', 'Zion', 'Priya', 'Mateo', 'Hana', 'Kofi', 'Lucia', 'Ravi'];
const LAST = ['Adams', 'Bennett', 'Chen', 'Diaz', 'Evans', 'Fischer', 'Garcia', 'Huang', 'Ibrahim', 'Jensen', 'Khan', 'Larsen', 'Moreno', 'Nakamura', 'Okafor', 'Patel', 'Quintero', 'Rossi', 'Silva', 'Tanaka', 'Usman', 'Vargas', 'Wagner', 'Xu', 'Yilmaz', 'Zhang'];

function pad(number, size) {
  return String(number).padStart(size, '0');
}

function dateFrom(days) {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function buildEmployees() {
  const random = seeded(2026);
  const people = FIXED.map(([first, last, department, title, location]) => ({ first, last, department, title, location }));
  const used = new Set(people.map((person) => `${person.first} ${person.last}`));
  while (people.length < 64) {
    const first = FIRST[Math.floor(random() * FIRST.length)];
    const last = LAST[Math.floor(random() * LAST.length)];
    if (used.has(`${first} ${last}`)) continue;
    used.add(`${first} ${last}`);
    const department = DEPARTMENTS[Math.floor(random() * DEPARTMENTS.length)];
    const titles = TITLES[department];
    people.push({ first, last, department, title: titles[Math.floor(random() * titles.length)], location: LOCATIONS[Math.floor(random() * LOCATIONS.length)] });
  }
  return people.map((person, index) => {
    const id = `E${1001 + index}`;
    const handle = `${person.first}.${person.last}`.toLowerCase();
    return {
      id,
      firstName: person.first,
      lastName: person.last,
      name: `${person.first} ${person.last}`,
      department: person.department,
      title: person.title,
      location: person.location,
      email: `${handle}@northwind.example`,
      phone: `555-01${pad(10 + index, 2)}-${pad(Math.floor(random() * 9000) + 1000, 4)}`,
      startDate: dateFrom(200 + Math.floor(random() * 2400)),
      status: random() < 0.08 ? 'On leave' : 'Active',
      projects: Math.floor(random() * 6) + 1,
    };
  });
}

export const EMPLOYEES = buildEmployees();

// Managers: the first person in each department (by id) manages the rest.
for (const employee of EMPLOYEES) {
  const lead = EMPLOYEES.find((other) => other.department === employee.department);
  employee.manager = lead && lead.id !== employee.id ? lead.id : '';
}

export const CATEGORIES = ['Laptops', 'Monitors', 'Phones', 'Audio', 'Accessories'];

// Laptops, monitors, and phones are written by hand because challenges depend on their exact order.
const HAND = [
  ['Nimbus 13', 'Laptops', 899, 7, '13-inch ultralight, 16 GB RAM, 512 GB SSD'],
  ['Lumen Air', 'Laptops', 1049, 11, '14-inch, 16 GB RAM, all-day battery'],
  ['Aurora 14', 'Laptops', 1149, 5, '14-inch OLED, 32 GB RAM, 1 TB SSD'],
  ['Vector 15 Pro', 'Laptops', 1499, 9, '15-inch, discrete graphics, 32 GB RAM'],
  ['Atlas 16 Studio', 'Laptops', 1899, 3, '16-inch creator laptop, 64 GB RAM'],
  ['Pico Book 11', 'Laptops', 649, 0, '11-inch classroom laptop (sold out)'],
  ['Strata 14 Business', 'Laptops', 1199, 14, '14-inch, vPro, 3-year warranty'],
  ['Clarity 24', 'Monitors', 189, 6, '24-inch 1080p IPS monitor'],
  ['Clarity 27 QHD', 'Monitors', 219, 18, '27-inch 1440p IPS monitor'],
  ['Horizon 34 Ultrawide', 'Monitors', 549, 4, '34-inch curved ultrawide'],
  ['Prism 32 4K', 'Monitors', 699, 8, '32-inch 4K HDR monitor'],
  ['Pulse X', 'Phones', 399, 0, '6.1-inch, 128 GB (sold out)'],
  ['Pulse X Plus', 'Phones', 529, 12, '6.7-inch, 256 GB'],
  ['Orbit Mini', 'Phones', 449, 9, '5.8-inch, 128 GB'],
  ['Orbit Pro Max', 'Phones', 1099, 5, '6.9-inch, 512 GB, titanium'],
];
const AUDIO = ['Echo Buds', 'Echo Buds Pro', 'Studio Cans', 'Room Speaker', 'Desk Mic', 'Travel Speaker'];
const ACCESSORIES = ['USB-C Dock', 'Wireless Mouse', 'Mechanical Keyboard', 'Laptop Stand', 'Webcam HD', 'Cable Kit', 'Privacy Screen', 'Charging Brick', 'Desk Mat', 'Headset Hook'];

function buildProducts() {
  const random = seeded(77);
  const rows = HAND.map(([name, category, price, stock, summary]) => ({ name, category, price, stock, summary }));
  for (const name of AUDIO) rows.push({ name, category: 'Audio', price: 39 + Math.round(random() * 320), stock: Math.floor(random() * 30), summary: 'Wireless audio gear for focus and calls' });
  for (const name of ACCESSORIES) rows.push({ name, category: 'Accessories', price: 12 + Math.round(random() * 180), stock: Math.floor(random() * 60), summary: 'Workspace accessory' });
  return rows.map((row, index) => ({
    id: `P${pad(index + 1, 3)}`,
    sku: `NW-${row.category.slice(0, 3).toUpperCase()}-${pad(index * 37 + 101, 4)}`,
    rating: Math.round((3.4 + random() * 1.6) * 10) / 10,
    ...row,
  }));
}

export const PRODUCTS = buildProducts();

// Daily performance per department for the 90 days before TODAY. The trends are chosen so the
// leader depends on the date range: Engineering leads over 90 days, Sales over the last 30.
const PERFORMANCE = {
  Engineering: [140, -0.6],
  Sales: [70, 0.5],
  Marketing: [58, 0.1],
  Finance: [46, 0],
  Operations: [62, 0.15],
  Support: [44, 0.2],
  People: [30, 0.05],
};

function buildDaily() {
  const random = seeded(31);
  const rows = [];
  for (let day = 89; day >= 0; day -= 1) {
    const position = (89 - day) / 89;
    for (const department of DEPARTMENTS) {
      const [base, trend] = PERFORMANCE[department];
      const noise = 0.9 + random() * 0.2;
      rows.push({
        date: dateFrom(day),
        department,
        revenue: Math.round(base * (1 + trend * position) * noise * 100),
        deals: Math.max(0, Math.round((base / 14) * (1 + trend * position) * noise)),
        satisfaction: Math.round((80 + random() * 18) * 10) / 10,
      });
    }
  }
  return rows;
}

export const DAILY = buildDaily();

export const OPEN_ROLES = [
  { id: 'R-201', title: 'Frontend Engineer', department: 'Engineering' },
  { id: 'R-202', title: 'Data Analyst', department: 'Finance' },
  { id: 'R-203', title: 'Account Executive', department: 'Sales' },
  { id: 'R-204', title: 'Support Specialist', department: 'Support' },
  { id: 'R-205', title: 'Logistics Coordinator', department: 'Operations' },
];

export const SKILLS = ['SQL', 'Python', 'JavaScript', 'Excel', 'Tableau', 'Salesforce', 'Customer service', 'Project management'];

export function daysBefore(days) {
  return dateFrom(days);
}
