// Industry templates for business-type-aware onboarding
// Each template defines default departments, services, priorities, settings, and terminology

export interface IndustrySubtype {
  key: string;
  label: string;
  description: string;
}

export interface TemplateService {
  name: string;
  code: string;
  estimatedTime: number; // minutes
}

export interface TemplateDepartment {
  name: string;
  code: string;
  services: TemplateService[];
}

export interface TemplatePriority {
  name: string;
  icon: string;
  color: string;
  weight: number;
}

export interface IndustryTerminology {
  office: string;
  officePlural: string;
  desk: string;
  deskPlural: string;
  customer: string;
  customerPlural: string;
  department: string;
  departmentPlural: string;
}

export interface IndustryTemplate {
  type: string;
  label: string;
  icon: string; // Lucide icon name
  description: string;
  subtypes: IndustrySubtype[];
  departments: TemplateDepartment[];
  priorityCategories: TemplatePriority[];
  recommendedSettings: Record<string, unknown>;
  featureFlags: string[];
  terminology: IndustryTerminology;
}

export const industryTemplates: IndustryTemplate[] = [
  // ─────────────────────────────────────────────
  // 1. RESTAURANT
  // ─────────────────────────────────────────────
  {
    type: 'restaurant',
    label: 'Restaurant',
    icon: 'UtensilsCrossed',
    description: 'Restaurants, cafes, food courts, and dining establishments',
    subtypes: [
      { key: 'fast_food', label: 'Fast Food', description: 'Quick-service restaurants and takeout' },
      { key: 'casual_dining', label: 'Casual Dining', description: 'Sit-down restaurants with table service' },
      { key: 'fine_dining', label: 'Fine Dining', description: 'Upscale dining with reservations' },
      { key: 'cafe_bakery', label: 'Cafe / Bakery', description: 'Coffee shops, bakeries, and light bites' },
      { key: 'buffet', label: 'Buffet', description: 'Self-service buffet restaurants' },
      { key: 'food_court', label: 'Food Court', description: 'Multi-vendor food halls' },
      { key: 'food_truck', label: 'Food Truck', description: 'Mobile food service' },
    ],
    departments: [
      {
        name: 'Waitlist',
        code: 'WAIT',
        services: [
          { name: 'Walk-in Seating', code: 'WALK', estimatedTime: 15 },
          { name: 'Large Party (6+)', code: 'LRGE', estimatedTime: 25 },
          { name: 'Bar Seating', code: 'BAR', estimatedTime: 10 },
          { name: 'Patio / Outdoor', code: 'PAT', estimatedTime: 15 },
        ],
      },
      {
        name: 'Takeout & Delivery',
        code: 'TAKE',
        services: [
          { name: 'Order Pickup', code: 'PICK', estimatedTime: 5 },
          { name: 'Catering Order', code: 'CATR', estimatedTime: 15 },
        ],
      },
      {
        name: 'Reservations',
        code: 'RESV',
        services: [
          { name: 'Reserved Table', code: 'RTBL', estimatedTime: 5 },
          { name: 'Private Event', code: 'PRVT', estimatedTime: 10 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'VIP Guest', icon: 'Star', color: '#f59e0b', weight: 30 },
      { name: 'Reservation', icon: 'CalendarCheck', color: '#3b82f6', weight: 20 },
      { name: 'Elderly / Disabled', icon: 'Heart', color: '#ef4444', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'list',
      auto_no_show_timeout: 10,
      max_queue_size: 30,
    },
    featureFlags: ['table_management', 'party_size', 'waitlist_mode', 'takeout_queue', 'reservations'],
    terminology: {
      office: 'Location',
      officePlural: 'Locations',
      desk: 'Table',
      deskPlural: 'Tables',
      customer: 'Guest',
      customerPlural: 'Guests',
      department: 'Section',
      departmentPlural: 'Sections',
    },
  },

  // ─────────────────────────────────────────────
  // 2. HEALTHCARE
  // ─────────────────────────────────────────────
  {
    type: 'healthcare',
    label: 'Healthcare',
    icon: 'Stethoscope',
    description: 'Clinics, hospitals, dental, vision, and medical practices',
    subtypes: [
      { key: 'general_clinic', label: 'General Clinic', description: 'Primary care and family medicine' },
      { key: 'hospital', label: 'Hospital', description: 'Multi-department hospital' },
      { key: 'dental', label: 'Dental Practice', description: 'Dentistry and oral care' },
      { key: 'optometry', label: 'Vision / Optometry', description: 'Eye care and vision services' },
      { key: 'mental_health', label: 'Mental Health', description: 'Counseling and therapy' },
      { key: 'urgent_care', label: 'Urgent Care', description: 'Walk-in urgent medical care' },
      { key: 'veterinary', label: 'Veterinary', description: 'Animal healthcare' },
      { key: 'physical_therapy', label: 'Physical Therapy', description: 'Rehabilitation and therapy' },
    ],
    departments: [
      {
        name: 'General Medicine',
        code: 'GEN',
        services: [
          { name: 'Consultation', code: 'CONS', estimatedTime: 20 },
          { name: 'Follow-up Visit', code: 'FOLL', estimatedTime: 10 },
          { name: 'Vaccination', code: 'VACC', estimatedTime: 10 },
          { name: 'Annual Physical', code: 'PHYS', estimatedTime: 30 },
        ],
      },
      {
        name: 'Laboratory',
        code: 'LAB',
        services: [
          { name: 'Blood Work', code: 'BLOD', estimatedTime: 10 },
          { name: 'Urine Test', code: 'URIN', estimatedTime: 5 },
          { name: 'Imaging / X-Ray', code: 'XRAY', estimatedTime: 15 },
        ],
      },
      {
        name: 'Pharmacy',
        code: 'PHRM',
        services: [
          { name: 'Prescription Pickup', code: 'RXPK', estimatedTime: 5 },
          { name: 'Medication Consultation', code: 'RXCN', estimatedTime: 10 },
        ],
      },
      {
        name: 'Specialist',
        code: 'SPEC',
        services: [
          { name: 'Specialist Consultation', code: 'SPCC', estimatedTime: 30 },
          { name: 'Procedure', code: 'PROC', estimatedTime: 45 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Emergency', icon: 'AlertTriangle', color: '#ef4444', weight: 50 },
      { name: 'Elderly (65+)', icon: 'Heart', color: '#f59e0b', weight: 30 },
      { name: 'Pregnant', icon: 'Baby', color: '#ec4899', weight: 35 },
      { name: 'Disabled', icon: 'Accessibility', color: '#8b5cf6', weight: 30 },
      { name: 'Child (Under 5)', icon: 'Baby', color: '#06b6d4', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'hybrid',
      default_display_layout: 'department_split',
      auto_no_show_timeout: 15,
      max_queue_size: 50,
    },
    featureFlags: ['intake_forms', 'appointment_booking', 'patient_triage', 'insurance_capture', 'multi_department_routing'],
    terminology: {
      office: 'Clinic',
      officePlural: 'Clinics',
      desk: 'Room',
      deskPlural: 'Rooms',
      customer: 'Patient',
      customerPlural: 'Patients',
      department: 'Department',
      departmentPlural: 'Departments',
    },
  },

  // ─────────────────────────────────────────────
  // 3. BANK & FINANCIAL
  // ─────────────────────────────────────────────
  {
    type: 'bank',
    label: 'Bank & Financial',
    icon: 'Landmark',
    description: 'Banks, credit unions, insurance, and financial services',
    subtypes: [
      { key: 'retail_bank', label: 'Retail Bank', description: 'Consumer banking services' },
      { key: 'commercial_bank', label: 'Commercial Bank', description: 'Business and commercial banking' },
      { key: 'credit_union', label: 'Credit Union', description: 'Member-owned financial cooperative' },
      { key: 'insurance', label: 'Insurance Office', description: 'Insurance claims and policies' },
      { key: 'investment', label: 'Investment Firm', description: 'Wealth management and investments' },
      { key: 'money_exchange', label: 'Money Exchange', description: 'Currency exchange and remittance' },
    ],
    departments: [
      {
        name: 'Teller Services',
        code: 'TELL',
        services: [
          { name: 'Deposit / Withdrawal', code: 'DEPW', estimatedTime: 5 },
          { name: 'Check Cashing', code: 'CHCK', estimatedTime: 3 },
          { name: 'Wire Transfer', code: 'WIRE', estimatedTime: 10 },
          { name: 'Foreign Exchange', code: 'FXCH', estimatedTime: 8 },
        ],
      },
      {
        name: 'Account Services',
        code: 'ACCT',
        services: [
          { name: 'New Account Opening', code: 'NACC', estimatedTime: 30 },
          { name: 'Account Inquiry', code: 'AINQ', estimatedTime: 10 },
          { name: 'Card Services', code: 'CARD', estimatedTime: 15 },
          { name: 'Account Closure', code: 'ACLS', estimatedTime: 15 },
        ],
      },
      {
        name: 'Loan Services',
        code: 'LOAN',
        services: [
          { name: 'Loan Application', code: 'LAPP', estimatedTime: 45 },
          { name: 'Loan Inquiry', code: 'LINQ', estimatedTime: 15 },
          { name: 'Mortgage Consultation', code: 'MORT', estimatedTime: 60 },
        ],
      },
      {
        name: 'Customer Service',
        code: 'CUST',
        services: [
          { name: 'General Inquiry', code: 'GINQ', estimatedTime: 10 },
          { name: 'Complaint / Dispute', code: 'CMPL', estimatedTime: 20 },
          { name: 'Document Request', code: 'DOCS', estimatedTime: 10 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'VIP / Premium', icon: 'Crown', color: '#f59e0b', weight: 40 },
      { name: 'Business Client', icon: 'Briefcase', color: '#3b82f6', weight: 30 },
      { name: 'Elderly', icon: 'Heart', color: '#ef4444', weight: 25 },
      { name: 'Disabled', icon: 'Accessibility', color: '#8b5cf6', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'department_split',
      auto_no_show_timeout: 5,
      max_queue_size: 40,
      ticket_number_prefix: 'B',
    },
    featureFlags: ['vip_routing', 'appointment_booking', 'multi_service_counter', 'document_checklist'],
    terminology: {
      office: 'Branch',
      officePlural: 'Branches',
      desk: 'Counter',
      deskPlural: 'Counters',
      customer: 'Client',
      customerPlural: 'Clients',
      department: 'Department',
      departmentPlural: 'Departments',
    },
  },

  // ─────────────────────────────────────────────
  // 4. GOVERNMENT
  // ─────────────────────────────────────────────
  {
    type: 'government',
    label: 'Government',
    icon: 'Building',
    description: 'Government offices, DMV, city hall, and public services',
    subtypes: [
      { key: 'dmv', label: 'DMV / Motor Vehicles', description: 'Driver licenses and vehicle registration' },
      { key: 'city_hall', label: 'City Hall / Municipal', description: 'Municipal government services' },
      { key: 'post_office', label: 'Post Office', description: 'Postal and mailing services' },
      { key: 'tax_office', label: 'Tax Office', description: 'Tax filing and payment' },
      { key: 'social_services', label: 'Social Services', description: 'Benefits and social welfare' },
      { key: 'immigration', label: 'Immigration', description: 'Visas, passports, and immigration' },
      { key: 'court', label: 'Courthouse', description: 'Court filings and hearings' },
      { key: 'embassy', label: 'Embassy / Consulate', description: 'Diplomatic and consular services' },
    ],
    departments: [
      {
        name: 'Information & Reception',
        code: 'INFO',
        services: [
          { name: 'General Information', code: 'GINF', estimatedTime: 5 },
          { name: 'Form Assistance', code: 'FORM', estimatedTime: 10 },
        ],
      },
      {
        name: 'Document Processing',
        code: 'DOCS',
        services: [
          { name: 'Application Submission', code: 'ASUB', estimatedTime: 15 },
          { name: 'Document Verification', code: 'DVER', estimatedTime: 20 },
          { name: 'Certificate Issuance', code: 'CERT', estimatedTime: 10 },
          { name: 'Renewal', code: 'RENW', estimatedTime: 15 },
        ],
      },
      {
        name: 'Payments & Fees',
        code: 'PAY',
        services: [
          { name: 'Fee Payment', code: 'FPAY', estimatedTime: 5 },
          { name: 'Fine Payment', code: 'FINE', estimatedTime: 5 },
          { name: 'Tax Payment', code: 'TPAY', estimatedTime: 10 },
        ],
      },
      {
        name: 'Appointments',
        code: 'APPT',
        services: [
          { name: 'Scheduled Appointment', code: 'SAPP', estimatedTime: 20 },
          { name: 'Interview', code: 'INTV', estimatedTime: 30 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Disabled', icon: 'Accessibility', color: '#8b5cf6', weight: 35 },
      { name: 'Elderly (65+)', icon: 'Heart', color: '#ef4444', weight: 30 },
      { name: 'Pregnant', icon: 'Baby', color: '#ec4899', weight: 30 },
      { name: 'Veteran', icon: 'Shield', color: '#059669', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'department_split',
      auto_no_show_timeout: 5,
      max_queue_size: 100,
      ticket_number_prefix: 'G',
    },
    featureFlags: ['document_checklist', 'appointment_booking', 'multi_department_routing', 'intake_forms'],
    terminology: {
      office: 'Office',
      officePlural: 'Offices',
      desk: 'Window',
      deskPlural: 'Windows',
      customer: 'Citizen',
      customerPlural: 'Citizens',
      department: 'Department',
      departmentPlural: 'Departments',
    },
  },

  // ─────────────────────────────────────────────
  // 5. HOTEL & HOSPITALITY
  // ─────────────────────────────────────────────
  {
    type: 'hotel',
    label: 'Hotel & Hospitality',
    icon: 'Hotel',
    description: 'Hotels, resorts, hostels, and hospitality',
    subtypes: [
      { key: 'boutique', label: 'Boutique Hotel', description: 'Small, independent luxury hotel' },
      { key: 'chain', label: 'Chain Hotel', description: 'Multi-property hotel brand' },
      { key: 'resort', label: 'Resort', description: 'Full-service vacation resort' },
      { key: 'hostel', label: 'Hostel', description: 'Budget accommodation' },
      { key: 'serviced_apartments', label: 'Serviced Apartments', description: 'Extended stay apartments' },
    ],
    departments: [
      {
        name: 'Front Desk',
        code: 'FRNT',
        services: [
          { name: 'Check-in', code: 'CHIN', estimatedTime: 10 },
          { name: 'Check-out', code: 'CHOT', estimatedTime: 5 },
          { name: 'Room Change', code: 'RMCH', estimatedTime: 10 },
          { name: 'Key Replacement', code: 'KEYP', estimatedTime: 3 },
        ],
      },
      {
        name: 'Concierge',
        code: 'CONC',
        services: [
          { name: 'Tour Booking', code: 'TOUR', estimatedTime: 15 },
          { name: 'Transportation', code: 'TRAN', estimatedTime: 10 },
          { name: 'Restaurant Reservation', code: 'RRSV', estimatedTime: 5 },
          { name: 'General Inquiry', code: 'GINQ', estimatedTime: 5 },
        ],
      },
      {
        name: 'Guest Services',
        code: 'GSVS',
        services: [
          { name: 'Room Service Request', code: 'RMSV', estimatedTime: 5 },
          { name: 'Complaint / Issue', code: 'CMPL', estimatedTime: 15 },
          { name: 'Billing Inquiry', code: 'BILL', estimatedTime: 10 },
        ],
      },
      {
        name: 'Spa & Wellness',
        code: 'SPA',
        services: [
          { name: 'Spa Appointment', code: 'SPAP', estimatedTime: 60 },
          { name: 'Pool / Gym Access', code: 'POOL', estimatedTime: 5 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'VIP Guest', icon: 'Crown', color: '#f59e0b', weight: 40 },
      { name: 'Loyalty Member', icon: 'Star', color: '#3b82f6', weight: 30 },
      { name: 'Suite Guest', icon: 'Gem', color: '#8b5cf6', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'hybrid',
      default_display_layout: 'list',
      auto_no_show_timeout: 10,
      max_queue_size: 30,
    },
    featureFlags: ['room_assignment', 'concierge_queue', 'loyalty_priority', 'appointment_booking'],
    terminology: {
      office: 'Property',
      officePlural: 'Properties',
      desk: 'Station',
      deskPlural: 'Stations',
      customer: 'Guest',
      customerPlural: 'Guests',
      department: 'Department',
      departmentPlural: 'Departments',
    },
  },

  // ─────────────────────────────────────────────
  // 6. RETAIL
  // ─────────────────────────────────────────────
  {
    type: 'retail',
    label: 'Retail',
    icon: 'ShoppingBag',
    description: 'Retail stores, supermarkets, and shopping',
    subtypes: [
      { key: 'single_store', label: 'Single Store', description: 'Independent retail shop' },
      { key: 'chain', label: 'Chain Store', description: 'Multi-location retail chain' },
      { key: 'department_store', label: 'Department Store', description: 'Large multi-department retail' },
      { key: 'electronics', label: 'Electronics Store', description: 'Tech and electronics retail' },
      { key: 'supermarket', label: 'Supermarket', description: 'Grocery and household goods' },
      { key: 'luxury', label: 'Luxury Boutique', description: 'High-end retail' },
    ],
    departments: [
      {
        name: 'Customer Service',
        code: 'CUST',
        services: [
          { name: 'General Inquiry', code: 'GINQ', estimatedTime: 5 },
          { name: 'Returns & Exchange', code: 'RETN', estimatedTime: 10 },
          { name: 'Complaint', code: 'CMPL', estimatedTime: 10 },
        ],
      },
      {
        name: 'Sales',
        code: 'SALE',
        services: [
          { name: 'Product Consultation', code: 'PCON', estimatedTime: 15 },
          { name: 'Personal Shopping', code: 'PRSH', estimatedTime: 30 },
          { name: 'Price Match', code: 'PMCH', estimatedTime: 5 },
        ],
      },
      {
        name: 'Checkout',
        code: 'CHKT',
        services: [
          { name: 'Express Checkout', code: 'EXPR', estimatedTime: 3 },
          { name: 'Large Order', code: 'LRGE', estimatedTime: 10 },
        ],
      },
      {
        name: 'Technical Support',
        code: 'TECH',
        services: [
          { name: 'Device Setup', code: 'DSET', estimatedTime: 20 },
          { name: 'Repair Drop-off', code: 'REPR', estimatedTime: 10 },
          { name: 'Warranty Claim', code: 'WARR', estimatedTime: 15 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'VIP Member', icon: 'Crown', color: '#f59e0b', weight: 30 },
      { name: 'Quick Service', icon: 'Zap', color: '#3b82f6', weight: 15 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'list',
      auto_no_show_timeout: 5,
      max_queue_size: 30,
    },
    featureFlags: ['appointment_booking', 'vip_routing'],
    terminology: {
      office: 'Store',
      officePlural: 'Stores',
      desk: 'Counter',
      deskPlural: 'Counters',
      customer: 'Customer',
      customerPlural: 'Customers',
      department: 'Department',
      departmentPlural: 'Departments',
    },
  },

  // ─────────────────────────────────────────────
  // 7. BARBERSHOP & SALON
  // ─────────────────────────────────────────────
  {
    type: 'salon',
    label: 'Barbershop & Salon',
    icon: 'Scissors',
    description: 'Barbershops, hair salons, nail salons, and spas',
    subtypes: [
      { key: 'barbershop', label: 'Barbershop', description: 'Men\'s grooming and haircuts' },
      { key: 'hair_salon', label: 'Hair Salon', description: 'Full hair care services' },
      { key: 'nail_salon', label: 'Nail Salon', description: 'Manicure and pedicure services' },
      { key: 'spa', label: 'Day Spa', description: 'Full spa and relaxation services' },
      { key: 'beauty_center', label: 'Beauty Center', description: 'Multi-service beauty establishment' },
    ],
    departments: [
      {
        name: 'Hair Services',
        code: 'HAIR',
        services: [
          { name: 'Haircut', code: 'HCUT', estimatedTime: 30 },
          { name: 'Beard Trim', code: 'BTRM', estimatedTime: 15 },
          { name: 'Hair Coloring', code: 'HCLR', estimatedTime: 60 },
          { name: 'Styling / Blowout', code: 'STYL', estimatedTime: 30 },
          { name: 'Treatment / Keratin', code: 'TRTM', estimatedTime: 45 },
        ],
      },
      {
        name: 'Nail Services',
        code: 'NAIL',
        services: [
          { name: 'Manicure', code: 'MANI', estimatedTime: 30 },
          { name: 'Pedicure', code: 'PEDI', estimatedTime: 40 },
          { name: 'Gel / Acrylic Nails', code: 'GELN', estimatedTime: 45 },
        ],
      },
      {
        name: 'Skin & Body',
        code: 'SKIN',
        services: [
          { name: 'Facial', code: 'FACE', estimatedTime: 45 },
          { name: 'Waxing', code: 'WAXN', estimatedTime: 20 },
          { name: 'Massage', code: 'MASS', estimatedTime: 60 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Regular Client', icon: 'Star', color: '#f59e0b', weight: 20 },
      { name: 'Appointment', icon: 'CalendarCheck', color: '#3b82f6', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'hybrid',
      default_display_layout: 'list',
      auto_no_show_timeout: 10,
      max_queue_size: 15,
    },
    featureFlags: ['stylist_selection', 'appointment_booking', 'service_combinations'],
    terminology: {
      office: 'Location',
      officePlural: 'Locations',
      desk: 'Chair',
      deskPlural: 'Chairs',
      customer: 'Client',
      customerPlural: 'Clients',
      department: 'Service Area',
      departmentPlural: 'Service Areas',
    },
  },

  // ─────────────────────────────────────────────
  // 8. PHARMACY
  // ─────────────────────────────────────────────
  {
    type: 'pharmacy',
    label: 'Pharmacy',
    icon: 'Pill',
    description: 'Pharmacies and dispensing services',
    subtypes: [
      { key: 'retail_pharmacy', label: 'Retail Pharmacy', description: 'Community and chain pharmacies' },
      { key: 'hospital_pharmacy', label: 'Hospital Pharmacy', description: 'In-hospital dispensing' },
      { key: 'compounding', label: 'Compounding Pharmacy', description: 'Custom medication preparation' },
    ],
    departments: [
      {
        name: 'Dispensing',
        code: 'DISP',
        services: [
          { name: 'Prescription Pickup', code: 'RXPK', estimatedTime: 5 },
          { name: 'New Prescription', code: 'NWRX', estimatedTime: 15 },
          { name: 'Prescription Refill', code: 'RFIL', estimatedTime: 10 },
        ],
      },
      {
        name: 'Consultation',
        code: 'CONS',
        services: [
          { name: 'Pharmacist Consultation', code: 'PCON', estimatedTime: 10 },
          { name: 'Medication Review', code: 'MREV', estimatedTime: 15 },
        ],
      },
      {
        name: 'Health Services',
        code: 'HLTH',
        services: [
          { name: 'Vaccination', code: 'VACC', estimatedTime: 10 },
          { name: 'Blood Pressure Check', code: 'BPCK', estimatedTime: 5 },
          { name: 'Health Screening', code: 'SCRN', estimatedTime: 15 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Urgent Medication', icon: 'AlertTriangle', color: '#ef4444', weight: 40 },
      { name: 'Elderly', icon: 'Heart', color: '#f59e0b', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'list',
      auto_no_show_timeout: 5,
      max_queue_size: 30,
    },
    featureFlags: ['appointment_booking', 'intake_forms'],
    terminology: {
      office: 'Pharmacy',
      officePlural: 'Pharmacies',
      desk: 'Window',
      deskPlural: 'Windows',
      customer: 'Patient',
      customerPlural: 'Patients',
      department: 'Section',
      departmentPlural: 'Sections',
    },
  },

  // ─────────────────────────────────────────────
  // 9. EDUCATION
  // ─────────────────────────────────────────────
  {
    type: 'education',
    label: 'Education',
    icon: 'GraduationCap',
    description: 'Universities, schools, training centers, and libraries',
    subtypes: [
      { key: 'university', label: 'University', description: 'Higher education institution' },
      { key: 'school', label: 'School (K-12)', description: 'Primary and secondary education' },
      { key: 'training_center', label: 'Training Center', description: 'Professional training and certification' },
      { key: 'library', label: 'Library', description: 'Public or academic library' },
    ],
    departments: [
      {
        name: 'Admissions',
        code: 'ADMN',
        services: [
          { name: 'Application Inquiry', code: 'APIQ', estimatedTime: 15 },
          { name: 'Document Submission', code: 'DSUB', estimatedTime: 10 },
          { name: 'Campus Tour', code: 'TOUR', estimatedTime: 30 },
        ],
      },
      {
        name: 'Student Services',
        code: 'STUD',
        services: [
          { name: 'Academic Advising', code: 'ADVS', estimatedTime: 20 },
          { name: 'Course Registration', code: 'CREG', estimatedTime: 10 },
          { name: 'Transcript Request', code: 'TRNS', estimatedTime: 5 },
        ],
      },
      {
        name: 'Financial Aid',
        code: 'FAID',
        services: [
          { name: 'Scholarship Inquiry', code: 'SCHL', estimatedTime: 15 },
          { name: 'Loan Application', code: 'LOAN', estimatedTime: 20 },
          { name: 'Payment Arrangement', code: 'PMNT', estimatedTime: 10 },
        ],
      },
      {
        name: 'IT Support',
        code: 'ITSP',
        services: [
          { name: 'Account / Password', code: 'ACCT', estimatedTime: 5 },
          { name: 'Device Help', code: 'DEVH', estimatedTime: 15 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Graduating Senior', icon: 'GraduationCap', color: '#f59e0b', weight: 25 },
      { name: 'International Student', icon: 'Globe', color: '#3b82f6', weight: 20 },
      { name: 'Disabled', icon: 'Accessibility', color: '#8b5cf6', weight: 30 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'department_split',
      auto_no_show_timeout: 10,
      max_queue_size: 40,
    },
    featureFlags: ['appointment_booking', 'intake_forms', 'document_checklist'],
    terminology: {
      office: 'Campus',
      officePlural: 'Campuses',
      desk: 'Desk',
      deskPlural: 'Desks',
      customer: 'Student',
      customerPlural: 'Students',
      department: 'Office',
      departmentPlural: 'Offices',
    },
  },

  // ─────────────────────────────────────────────
  // 10. TELECOM
  // ─────────────────────────────────────────────
  {
    type: 'telecom',
    label: 'Telecom',
    icon: 'Smartphone',
    description: 'Telecom carriers, service centers, and mobile stores',
    subtypes: [
      { key: 'carrier_store', label: 'Carrier Store', description: 'Mobile carrier retail store' },
      { key: 'service_center', label: 'Service Center', description: 'Repair and technical support center' },
    ],
    departments: [
      {
        name: 'Sales',
        code: 'SALE',
        services: [
          { name: 'New Line / Plan', code: 'NLIN', estimatedTime: 20 },
          { name: 'Device Purchase', code: 'DPUR', estimatedTime: 15 },
          { name: 'Plan Upgrade', code: 'UPGD', estimatedTime: 10 },
          { name: 'Accessories', code: 'ACCS', estimatedTime: 5 },
        ],
      },
      {
        name: 'Customer Service',
        code: 'CUST',
        services: [
          { name: 'Billing Inquiry', code: 'BILL', estimatedTime: 10 },
          { name: 'Plan Change', code: 'PLCH', estimatedTime: 10 },
          { name: 'Account Issue', code: 'ACIS', estimatedTime: 15 },
        ],
      },
      {
        name: 'Technical Support',
        code: 'TECH',
        services: [
          { name: 'Device Troubleshooting', code: 'TRBL', estimatedTime: 20 },
          { name: 'SIM Replacement', code: 'SIMR', estimatedTime: 5 },
          { name: 'Device Repair', code: 'REPR', estimatedTime: 30 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Business Account', icon: 'Briefcase', color: '#3b82f6', weight: 25 },
      { name: 'Premium Member', icon: 'Crown', color: '#f59e0b', weight: 30 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'list',
      auto_no_show_timeout: 5,
      max_queue_size: 25,
    },
    featureFlags: ['appointment_booking', 'intake_forms'],
    terminology: {
      office: 'Store',
      officePlural: 'Stores',
      desk: 'Counter',
      deskPlural: 'Counters',
      customer: 'Customer',
      customerPlural: 'Customers',
      department: 'Department',
      departmentPlural: 'Departments',
    },
  },

  // ─────────────────────────────────────────────
  // 11. AUTO SERVICES
  // ─────────────────────────────────────────────
  {
    type: 'auto',
    label: 'Auto Services',
    icon: 'Car',
    description: 'Car dealerships, repair shops, car washes, and inspections',
    subtypes: [
      { key: 'dealership', label: 'Car Dealership', description: 'New and used vehicle sales' },
      { key: 'repair_shop', label: 'Repair Shop', description: 'Auto repair and maintenance' },
      { key: 'car_wash', label: 'Car Wash', description: 'Car wash and detailing' },
      { key: 'tire_center', label: 'Tire Center', description: 'Tire sales and service' },
      { key: 'inspection', label: 'Inspection Station', description: 'Vehicle safety and emissions inspection' },
    ],
    departments: [
      {
        name: 'Sales',
        code: 'SALE',
        services: [
          { name: 'Test Drive', code: 'TDRV', estimatedTime: 30 },
          { name: 'Sales Consultation', code: 'SCON', estimatedTime: 20 },
          { name: 'Financing', code: 'FINC', estimatedTime: 30 },
          { name: 'Trade-in Appraisal', code: 'TRDI', estimatedTime: 20 },
        ],
      },
      {
        name: 'Service Center',
        code: 'SRVC',
        services: [
          { name: 'Oil Change', code: 'OILC', estimatedTime: 30 },
          { name: 'Tire Service', code: 'TIRE', estimatedTime: 30 },
          { name: 'General Repair', code: 'REPR', estimatedTime: 60 },
          { name: 'Vehicle Inspection', code: 'INSP', estimatedTime: 20 },
        ],
      },
      {
        name: 'Parts & Accessories',
        code: 'PART',
        services: [
          { name: 'Parts Inquiry', code: 'PINQ', estimatedTime: 10 },
          { name: 'Parts Pickup', code: 'PPIK', estimatedTime: 5 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Appointment', icon: 'CalendarCheck', color: '#3b82f6', weight: 25 },
      { name: 'Returning Customer', icon: 'Star', color: '#f59e0b', weight: 15 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'hybrid',
      default_display_layout: 'list',
      auto_no_show_timeout: 10,
      max_queue_size: 20,
    },
    featureFlags: ['appointment_booking', 'intake_forms'],
    terminology: {
      office: 'Location',
      officePlural: 'Locations',
      desk: 'Bay',
      deskPlural: 'Bays',
      customer: 'Customer',
      customerPlural: 'Customers',
      department: 'Department',
      departmentPlural: 'Departments',
    },
  },

  // ─────────────────────────────────────────────
  // 12. REAL ESTATE
  // ─────────────────────────────────────────────
  {
    type: 'real_estate',
    label: 'Real Estate',
    icon: 'Home',
    description: 'Real estate agencies, property management, and mortgage offices',
    subtypes: [
      { key: 'agency', label: 'Real Estate Agency', description: 'Property buying, selling, and leasing' },
      { key: 'property_management', label: 'Property Management', description: 'Tenant and property management' },
      { key: 'mortgage', label: 'Mortgage Office', description: 'Home loan and mortgage services' },
    ],
    departments: [
      {
        name: 'Sales & Leasing',
        code: 'SALE',
        services: [
          { name: 'Property Consultation', code: 'PCON', estimatedTime: 30 },
          { name: 'Property Viewing', code: 'VIEW', estimatedTime: 45 },
          { name: 'Lease Signing', code: 'LEAS', estimatedTime: 30 },
        ],
      },
      {
        name: 'Tenant Services',
        code: 'TENA',
        services: [
          { name: 'Maintenance Request', code: 'MREQ', estimatedTime: 10 },
          { name: 'Lease Renewal', code: 'LRNW', estimatedTime: 15 },
          { name: 'Move-in / Move-out', code: 'MOVE', estimatedTime: 20 },
        ],
      },
      {
        name: 'Finance',
        code: 'FINC',
        services: [
          { name: 'Mortgage Consultation', code: 'MORT', estimatedTime: 45 },
          { name: 'Payment Inquiry', code: 'PINQ', estimatedTime: 10 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Pre-approved Buyer', icon: 'CheckCircle', color: '#059669', weight: 25 },
      { name: 'Urgent Tenant', icon: 'AlertTriangle', color: '#ef4444', weight: 30 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'hybrid',
      default_display_layout: 'list',
      auto_no_show_timeout: 15,
      max_queue_size: 15,
    },
    featureFlags: ['appointment_booking', 'document_checklist'],
    terminology: {
      office: 'Office',
      officePlural: 'Offices',
      desk: 'Desk',
      deskPlural: 'Desks',
      customer: 'Client',
      customerPlural: 'Clients',
      department: 'Department',
      departmentPlural: 'Departments',
    },
  },

  // ─────────────────────────────────────────────
  // 13. GYM & FITNESS
  // ─────────────────────────────────────────────
  {
    type: 'fitness',
    label: 'Gym & Fitness',
    icon: 'Dumbbell',
    description: 'Gyms, yoga studios, personal training, and sports clubs',
    subtypes: [
      { key: 'gym', label: 'Gym', description: 'General fitness center' },
      { key: 'yoga_studio', label: 'Yoga / Pilates Studio', description: 'Yoga and mind-body fitness' },
      { key: 'personal_training', label: 'Personal Training', description: 'One-on-one training studio' },
      { key: 'sports_club', label: 'Sports Club', description: 'Multi-sport facility' },
    ],
    departments: [
      {
        name: 'Membership',
        code: 'MEMB',
        services: [
          { name: 'New Membership', code: 'NMEM', estimatedTime: 15 },
          { name: 'Membership Renewal', code: 'MRNW', estimatedTime: 5 },
          { name: 'Membership Inquiry', code: 'MINQ', estimatedTime: 10 },
          { name: 'Guest Pass', code: 'GPAS', estimatedTime: 5 },
        ],
      },
      {
        name: 'Training',
        code: 'TRNG',
        services: [
          { name: 'Personal Training Session', code: 'PTRN', estimatedTime: 60 },
          { name: 'Fitness Assessment', code: 'FASS', estimatedTime: 30 },
          { name: 'Class Registration', code: 'CLSS', estimatedTime: 5 },
        ],
      },
      {
        name: 'Facilities',
        code: 'FACL',
        services: [
          { name: 'Locker Assignment', code: 'LOCK', estimatedTime: 3 },
          { name: 'Equipment Issue', code: 'EQIP', estimatedTime: 5 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'VIP Member', icon: 'Crown', color: '#f59e0b', weight: 25 },
      { name: 'Appointment', icon: 'CalendarCheck', color: '#3b82f6', weight: 20 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'list',
      auto_no_show_timeout: 10,
      max_queue_size: 20,
    },
    featureFlags: ['appointment_booking', 'service_combinations'],
    terminology: {
      office: 'Location',
      officePlural: 'Locations',
      desk: 'Station',
      deskPlural: 'Stations',
      customer: 'Member',
      customerPlural: 'Members',
      department: 'Area',
      departmentPlural: 'Areas',
    },
  },

  // ─────────────────────────────────────────────
  // 14. AIRLINE & TRAVEL
  // ─────────────────────────────────────────────
  {
    type: 'airline',
    label: 'Airline & Travel',
    icon: 'Plane',
    description: 'Airlines, airports, travel agencies, and transportation',
    subtypes: [
      { key: 'check_in', label: 'Airport Check-in', description: 'Airline check-in counters' },
      { key: 'gate_lounge', label: 'Gate / Boarding', description: 'Boarding gate management' },
      { key: 'baggage', label: 'Baggage Services', description: 'Lost luggage and baggage claims' },
      { key: 'lounge', label: 'Airport Lounge', description: 'VIP and business lounge' },
    ],
    departments: [
      {
        name: 'Check-in',
        code: 'CHIN',
        services: [
          { name: 'Economy Check-in', code: 'ECHK', estimatedTime: 5 },
          { name: 'Business / First Check-in', code: 'BCHK', estimatedTime: 5 },
          { name: 'Baggage Drop', code: 'BDRP', estimatedTime: 3 },
          { name: 'Special Assistance', code: 'SASS', estimatedTime: 10 },
        ],
      },
      {
        name: 'Customer Service',
        code: 'CUST',
        services: [
          { name: 'Flight Change', code: 'FCHG', estimatedTime: 15 },
          { name: 'Refund Request', code: 'RFND', estimatedTime: 10 },
          { name: 'Lost Baggage', code: 'LBAG', estimatedTime: 15 },
        ],
      },
      {
        name: 'Boarding',
        code: 'BORD',
        services: [
          { name: 'Priority Boarding', code: 'PBRD', estimatedTime: 2 },
          { name: 'General Boarding', code: 'GBRD', estimatedTime: 2 },
          { name: 'Standby', code: 'STBY', estimatedTime: 5 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'First / Business Class', icon: 'Crown', color: '#f59e0b', weight: 40 },
      { name: 'Frequent Flyer', icon: 'Star', color: '#3b82f6', weight: 30 },
      { name: 'Special Needs', icon: 'Accessibility', color: '#8b5cf6', weight: 35 },
      { name: 'Families with Children', icon: 'Baby', color: '#ec4899', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'department_split',
      auto_no_show_timeout: 3,
      max_queue_size: 50,
    },
    featureFlags: ['loyalty_priority', 'multi_department_routing'],
    terminology: {
      office: 'Terminal',
      officePlural: 'Terminals',
      desk: 'Counter',
      deskPlural: 'Counters',
      customer: 'Passenger',
      customerPlural: 'Passengers',
      department: 'Service Area',
      departmentPlural: 'Service Areas',
    },
  },

  // ─────────────────────────────────────────────
  // 15. LEGAL
  // ─────────────────────────────────────────────
  {
    type: 'legal',
    label: 'Legal',
    icon: 'Scale',
    description: 'Law firms, notary offices, and mediation centers',
    subtypes: [
      { key: 'law_firm', label: 'Law Firm', description: 'General or specialized legal practice' },
      { key: 'notary', label: 'Notary Office', description: 'Notarization and document authentication' },
      { key: 'mediation', label: 'Mediation Center', description: 'Dispute resolution and mediation' },
    ],
    departments: [
      {
        name: 'Client Intake',
        code: 'INTK',
        services: [
          { name: 'Initial Consultation', code: 'ICON', estimatedTime: 30 },
          { name: 'Case Review', code: 'CREV', estimatedTime: 20 },
          { name: 'Document Drop-off', code: 'DDOF', estimatedTime: 5 },
        ],
      },
      {
        name: 'Notary Services',
        code: 'NOTR',
        services: [
          { name: 'Document Notarization', code: 'NOTZ', estimatedTime: 10 },
          { name: 'Affidavit / Oath', code: 'AFDT', estimatedTime: 15 },
          { name: 'Power of Attorney', code: 'POA', estimatedTime: 20 },
        ],
      },
      {
        name: 'Document Services',
        code: 'DOCS',
        services: [
          { name: 'Contract Review', code: 'CTRV', estimatedTime: 30 },
          { name: 'Document Pickup', code: 'DPIK', estimatedTime: 5 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Urgent / Deadline', icon: 'AlertTriangle', color: '#ef4444', weight: 35 },
      { name: 'Existing Client', icon: 'Star', color: '#f59e0b', weight: 20 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'hybrid',
      default_display_layout: 'list',
      auto_no_show_timeout: 15,
      max_queue_size: 15,
    },
    featureFlags: ['appointment_booking', 'document_checklist', 'intake_forms'],
    terminology: {
      office: 'Office',
      officePlural: 'Offices',
      desk: 'Office',
      deskPlural: 'Offices',
      customer: 'Client',
      customerPlural: 'Clients',
      department: 'Practice Area',
      departmentPlural: 'Practice Areas',
    },
  },

  // ─────────────────────────────────────────────
  // 16. LOGISTICS & SHIPPING
  // ─────────────────────────────────────────────
  {
    type: 'logistics',
    label: 'Logistics & Shipping',
    icon: 'Truck',
    description: 'Warehouses, courier centers, customs, and freight',
    subtypes: [
      { key: 'warehouse', label: 'Warehouse', description: 'Warehouse and distribution center' },
      { key: 'courier', label: 'Courier Center', description: 'Package pickup and delivery center' },
      { key: 'customs', label: 'Customs Office', description: 'Import/export customs clearance' },
      { key: 'freight', label: 'Freight Office', description: 'Freight and cargo services' },
    ],
    departments: [
      {
        name: 'Pickup & Drop-off',
        code: 'PKDP',
        services: [
          { name: 'Package Pickup', code: 'PPIK', estimatedTime: 5 },
          { name: 'Package Drop-off', code: 'PDRP', estimatedTime: 5 },
          { name: 'Large Shipment', code: 'LSHP', estimatedTime: 15 },
        ],
      },
      {
        name: 'Customer Service',
        code: 'CUST',
        services: [
          { name: 'Tracking Inquiry', code: 'TRKN', estimatedTime: 5 },
          { name: 'Claim / Damage Report', code: 'CLAM', estimatedTime: 15 },
          { name: 'Rate Quote', code: 'QUOT', estimatedTime: 10 },
        ],
      },
      {
        name: 'Documentation',
        code: 'DOCS',
        services: [
          { name: 'Customs Declaration', code: 'CUST', estimatedTime: 20 },
          { name: 'Import / Export Docs', code: 'IMEX', estimatedTime: 15 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Express / Urgent', icon: 'Zap', color: '#ef4444', weight: 35 },
      { name: 'Business Account', icon: 'Briefcase', color: '#3b82f6', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'list',
      auto_no_show_timeout: 5,
      max_queue_size: 30,
    },
    featureFlags: ['document_checklist'],
    terminology: {
      office: 'Center',
      officePlural: 'Centers',
      desk: 'Window',
      deskPlural: 'Windows',
      customer: 'Client',
      customerPlural: 'Clients',
      department: 'Section',
      departmentPlural: 'Sections',
    },
  },

  // ─────────────────────────────────────────────
  // 17. ENTERTAINMENT
  // ─────────────────────────────────────────────
  {
    type: 'entertainment',
    label: 'Entertainment',
    icon: 'Ticket',
    description: 'Theme parks, museums, cinemas, and event centers',
    subtypes: [
      { key: 'theme_park', label: 'Theme Park', description: 'Amusement and theme parks' },
      { key: 'museum', label: 'Museum / Gallery', description: 'Museums and art galleries' },
      { key: 'cinema', label: 'Cinema', description: 'Movie theaters' },
      { key: 'concert_venue', label: 'Concert / Event Venue', description: 'Live events and concerts' },
      { key: 'event_center', label: 'Event / Convention Center', description: 'Conferences and exhibitions' },
    ],
    departments: [
      {
        name: 'Ticketing',
        code: 'TICK',
        services: [
          { name: 'Ticket Purchase', code: 'TPCH', estimatedTime: 5 },
          { name: 'Will Call Pickup', code: 'WCAL', estimatedTime: 3 },
          { name: 'Group Booking', code: 'GRPB', estimatedTime: 10 },
        ],
      },
      {
        name: 'Guest Services',
        code: 'GSVS',
        services: [
          { name: 'Information', code: 'INFO', estimatedTime: 3 },
          { name: 'Lost & Found', code: 'LNFD', estimatedTime: 5 },
          { name: 'Complaint', code: 'CMPL', estimatedTime: 10 },
        ],
      },
      {
        name: 'Attractions',
        code: 'ATTR',
        services: [
          { name: 'Ride Queue', code: 'RIDE', estimatedTime: 30 },
          { name: 'VIP Experience', code: 'VEXP', estimatedTime: 15 },
          { name: 'Guided Tour', code: 'TOUR', estimatedTime: 45 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'VIP / Fast Pass', icon: 'Zap', color: '#f59e0b', weight: 40 },
      { name: 'Disabled / Accessibility', icon: 'Accessibility', color: '#8b5cf6', weight: 35 },
      { name: 'Families with Small Children', icon: 'Baby', color: '#ec4899', weight: 20 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'list',
      auto_no_show_timeout: 5,
      max_queue_size: 100,
    },
    featureFlags: ['vip_routing', 'waitlist_mode'],
    terminology: {
      office: 'Venue',
      officePlural: 'Venues',
      desk: 'Gate',
      deskPlural: 'Gates',
      customer: 'Visitor',
      customerPlural: 'Visitors',
      department: 'Area',
      departmentPlural: 'Areas',
    },
  },

  // ─────────────────────────────────────────────
  // 18. COWORKING
  // ─────────────────────────────────────────────
  {
    type: 'coworking',
    label: 'Coworking',
    icon: 'Laptop',
    description: 'Coworking spaces, business centers, and shared offices',
    subtypes: [
      { key: 'coworking_space', label: 'Coworking Space', description: 'Shared workspace and hot desks' },
      { key: 'business_center', label: 'Business Center', description: 'Serviced office and meeting rooms' },
    ],
    departments: [
      {
        name: 'Reception',
        code: 'RCPT',
        services: [
          { name: 'Check-in', code: 'CHIN', estimatedTime: 3 },
          { name: 'Day Pass', code: 'DPAS', estimatedTime: 5 },
          { name: 'Visitor Registration', code: 'VSTR', estimatedTime: 5 },
        ],
      },
      {
        name: 'Membership',
        code: 'MEMB',
        services: [
          { name: 'New Membership', code: 'NMEM', estimatedTime: 15 },
          { name: 'Membership Change', code: 'MCHG', estimatedTime: 10 },
          { name: 'Tour', code: 'TOUR', estimatedTime: 20 },
        ],
      },
      {
        name: 'Facilities',
        code: 'FACL',
        services: [
          { name: 'Meeting Room Booking', code: 'MTRM', estimatedTime: 5 },
          { name: 'IT Support', code: 'ITSP', estimatedTime: 10 },
          { name: 'Mail / Package', code: 'MAIL', estimatedTime: 3 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Premium Member', icon: 'Crown', color: '#f59e0b', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'list',
      auto_no_show_timeout: 10,
      max_queue_size: 15,
    },
    featureFlags: ['appointment_booking'],
    terminology: {
      office: 'Space',
      officePlural: 'Spaces',
      desk: 'Desk',
      deskPlural: 'Desks',
      customer: 'Member',
      customerPlural: 'Members',
      department: 'Area',
      departmentPlural: 'Areas',
    },
  },

  // ─────────────────────────────────────────────
  // 19. REPAIR & MAINTENANCE
  // ─────────────────────────────────────────────
  {
    type: 'repair',
    label: 'Repair & Maintenance',
    icon: 'Wrench',
    description: 'Electronics repair, appliance repair, and IT support',
    subtypes: [
      { key: 'electronics_repair', label: 'Electronics Repair', description: 'Phone, laptop, and gadget repair' },
      { key: 'appliance_repair', label: 'Appliance Repair', description: 'Home appliance service' },
      { key: 'it_support', label: 'IT Support', description: 'Computer and network support' },
    ],
    departments: [
      {
        name: 'Intake / Drop-off',
        code: 'INTK',
        services: [
          { name: 'Device Assessment', code: 'DASS', estimatedTime: 10 },
          { name: 'Repair Drop-off', code: 'RDRP', estimatedTime: 5 },
          { name: 'Quote Request', code: 'QUOT', estimatedTime: 10 },
        ],
      },
      {
        name: 'Pickup',
        code: 'PKUP',
        services: [
          { name: 'Repaired Device Pickup', code: 'RPIK', estimatedTime: 5 },
          { name: 'Payment & Collection', code: 'PYMT', estimatedTime: 5 },
        ],
      },
      {
        name: 'Support',
        code: 'SUPP',
        services: [
          { name: 'Walk-in Support', code: 'WKSP', estimatedTime: 20 },
          { name: 'Data Recovery', code: 'DREC', estimatedTime: 15 },
          { name: 'Software Setup', code: 'SWST', estimatedTime: 15 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'Warranty Repair', icon: 'Shield', color: '#059669', weight: 20 },
      { name: 'Business Client', icon: 'Briefcase', color: '#3b82f6', weight: 25 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'hybrid',
      default_display_layout: 'list',
      auto_no_show_timeout: 10,
      max_queue_size: 20,
    },
    featureFlags: ['appointment_booking', 'intake_forms'],
    terminology: {
      office: 'Shop',
      officePlural: 'Shops',
      desk: 'Bench',
      deskPlural: 'Benches',
      customer: 'Customer',
      customerPlural: 'Customers',
      department: 'Section',
      departmentPlural: 'Sections',
    },
  },

  // ─────────────────────────────────────────────
  // 20. OTHER / GENERIC
  // ─────────────────────────────────────────────
  {
    type: 'other',
    label: 'Other Business',
    icon: 'Building2',
    description: 'Other business types not listed above',
    subtypes: [
      { key: 'generic', label: 'General Business', description: 'Custom setup for any business' },
    ],
    departments: [
      {
        name: 'Reception',
        code: 'RCPT',
        services: [
          { name: 'General Inquiry', code: 'GINQ', estimatedTime: 10 },
          { name: 'Appointment', code: 'APPT', estimatedTime: 15 },
        ],
      },
      {
        name: 'Service',
        code: 'SRVC',
        services: [
          { name: 'Standard Service', code: 'STDS', estimatedTime: 15 },
          { name: 'Premium Service', code: 'PRMS', estimatedTime: 30 },
        ],
      },
      {
        name: 'Customer Support',
        code: 'SUPP',
        services: [
          { name: 'Support Request', code: 'SREQ', estimatedTime: 10 },
          { name: 'Complaint', code: 'CMPL', estimatedTime: 15 },
        ],
      },
    ],
    priorityCategories: [
      { name: 'VIP', icon: 'Star', color: '#f59e0b', weight: 30 },
      { name: 'Urgent', icon: 'AlertTriangle', color: '#ef4444', weight: 35 },
    ],
    recommendedSettings: {
      default_check_in_mode: 'self_service',
      default_display_layout: 'list',
      auto_no_show_timeout: 10,
      max_queue_size: 30,
    },
    featureFlags: ['appointment_booking'],
    terminology: {
      office: 'Office',
      officePlural: 'Offices',
      desk: 'Desk',
      deskPlural: 'Desks',
      customer: 'Customer',
      customerPlural: 'Customers',
      department: 'Department',
      departmentPlural: 'Departments',
    },
  },
];

// Helper to get a template by type
export function getIndustryTemplate(type: string): IndustryTemplate | undefined {
  return industryTemplates.find((t) => t.type === type);
}

// Helper to get default terminology (used when no business type is set)
export function getDefaultTerminology(): IndustryTerminology {
  return {
    office: 'Office',
    officePlural: 'Offices',
    desk: 'Desk',
    deskPlural: 'Desks',
    customer: 'Customer',
    customerPlural: 'Customers',
    department: 'Department',
    departmentPlural: 'Departments',
  };
}
