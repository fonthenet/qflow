export interface Solution {
  id: string;
  title: string;
  slug: string;
  icon: string;
  shortDescription: string;
  heroHeadline: string;
  heroSubheadline: string;
  painPoints: string[];
  features: { title: string; description: string; icon: string }[];
  useCases: { title: string; description: string }[];
  stats: { value: string; label: string }[];
}

export const solutions: Solution[] = [
  {
    id: 'restaurants',
    title: 'Restaurants',
    slug: 'restaurants',
    icon: 'UtensilsCrossed',
    shortDescription: 'Keep dining flow moving from walk-in arrival to seated service',
    heroHeadline: 'Turn Wait Times into Happy Guests',
    heroSubheadline: 'Let guests join before they crowd the host stand, track progress live, and arrive at the right moment for seating.',
    painPoints: [
      'Guests leave when they see a long line',
      'Manual host stand lists are messy and inaccurate',
      'Staff waste time calling out names',
      'No visibility into actual wait times',
    ],
    features: [
      { title: 'QR Arrival', description: 'Guests scan a QR code to enter the seating flow from their phone with no app download required.', icon: 'QrCode' },
      { title: 'Real-Time Position', description: 'Guests see their exact position and estimated wait time, updated live.', icon: 'Clock' },
      { title: 'Instant Notifications', description: 'Push notification sent to guest\'s phone the moment their table is ready.', icon: 'Bell' },
      { title: 'Party Size Management', description: 'Track party sizes and assign tables efficiently with group ticket support.', icon: 'Users' },
      { title: 'TV Display Board', description: 'Show queue status on a TV in your lobby — guests always know where they stand.', icon: 'Monitor' },
      { title: 'Analytics', description: 'Track peak hours, average wait times, and table turnover to optimize operations.', icon: 'BarChart3' },
    ],
    useCases: [
      { title: 'Busy Weekend Service', description: 'Guests scan the QR code outside, join the seating flow, and browse nearby shops while waiting. They get a push notification when their table is ready.' },
      { title: 'Multiple Dining Areas', description: 'Use departments to separate indoor, outdoor, and bar seating. Each area manages its own queue independently.' },
    ],
    stats: [
      { value: '40%', label: 'Reduction in walkouts' },
      { value: '3 min', label: 'Average setup time' },
      { value: '0', label: 'Apps to download' },
    ],
  },
  {
    id: 'clinics',
    title: 'Healthcare Clinics',
    slug: 'clinics',
    icon: 'Heart',
    shortDescription: 'Reduce waiting room congestion and improve patient flow',
    heroHeadline: 'Better Patient Experience, Less Waiting Room Stress',
    heroSubheadline: 'Patients check in digitally, wait from anywhere, and get notified when the doctor is ready — reducing crowding and improving satisfaction.',
    painPoints: [
      'Crowded waiting rooms increase infection risk',
      'Patients don\'t know how long they\'ll wait',
      'Reception staff overwhelmed with check-ins',
      'No-shows waste valuable appointment slots',
    ],
    features: [
      { title: 'Digital Check-In', description: 'Patients scan a QR code to check in and fill out intake forms on their phone.', icon: 'ClipboardCheck' },
      { title: 'Department Queues', description: 'Separate queues for general consultation, lab work, pharmacy — patients flow smoothly.', icon: 'Building2' },
      { title: 'Priority Patients', description: 'Elderly, disabled, and emergency patients get priority with configurable categories.', icon: 'Shield' },
      { title: 'Intake Forms', description: 'Custom forms per service — collect patient info, symptoms, insurance details before the visit.', icon: 'FileText' },
      { title: 'Appointment + Walk-In', description: 'Hybrid mode interleaves scheduled appointments with walk-in patients automatically.', icon: 'CalendarClock' },
      { title: 'Wait from Anywhere', description: 'Patients wait in their car or nearby — get notified when it\'s their turn.', icon: 'Smartphone' },
    ],
    useCases: [
      { title: 'Multi-Department Clinic', description: 'A patient checks in for a consultation, gets lab work, then picks up a prescription — each department manages its own queue.' },
      { title: 'Remote Waiting', description: 'Patients check in from the parking lot, wait in their car, and walk in only when notified — reducing waiting room density.' },
    ],
    stats: [
      { value: '60%', label: 'Less waiting room crowding' },
      { value: '5 min', label: 'Faster check-in' },
      { value: '25%', label: 'Reduction in no-shows' },
    ],
  },
  {
    id: 'retail',
    title: 'Retail Stores',
    slug: 'retail',
    icon: 'ShoppingBag',
    shortDescription: 'Transform your customer service experience',
    heroHeadline: 'No More Standing in Line',
    heroSubheadline: 'Customers join the queue digitally, browse the store while waiting, and get called to the counter when it\'s their turn.',
    painPoints: [
      'Long lines at checkout or service counter',
      'Customers leave without buying',
      'Staff can\'t predict demand peaks',
      'No way to prioritize service types',
    ],
    features: [
      { title: 'Service Counter Queue', description: 'Customers scan QR to join the returns, exchanges, or help desk queue.', icon: 'QrCode' },
      { title: 'Browse While Waiting', description: 'Customers continue shopping while tracking their position on their phone.', icon: 'ShoppingCart' },
      { title: 'Multiple Service Points', description: 'Run multiple counters for different service types simultaneously.', icon: 'LayoutGrid' },
      { title: 'Display Board', description: 'Large screen shows current queue status — customers know exactly when they\'re next.', icon: 'Monitor' },
      { title: 'Peak Hour Analytics', description: 'Identify busy periods and optimize staffing with real-time analytics.', icon: 'TrendingUp' },
      { title: 'Customer Feedback', description: 'Automatic post-service satisfaction survey on the customer\'s phone.', icon: 'Star' },
    ],
    useCases: [
      { title: 'Electronics Store', description: 'Customers join the queue at the help desk kiosk, continue browsing, and get a push notification when a specialist is available.' },
      { title: 'Returns Counter', description: 'Separate queue for returns and exchanges, with intake forms to capture order number and reason before the customer reaches the counter.' },
    ],
    stats: [
      { value: '35%', label: 'Increase in customer satisfaction' },
      { value: '20%', label: 'More browsing time (more sales)' },
      { value: '0', label: 'Paper tickets needed' },
    ],
  },
  {
    id: 'government',
    title: 'Government & Public Services',
    slug: 'government',
    icon: 'Landmark',
    shortDescription: 'Modernize citizen service flow across counters, appointments, and documents',
    heroHeadline: 'Efficient Public Services, Happy Citizens',
    heroSubheadline: 'From DMV to city hall — replace take-a-number machines with a modern arrival and service flow citizens can join from their phone.',
    painPoints: [
      'Citizens wait hours for simple services',
      'Old ticket machines break down',
      'No way to predict wait times',
      'Multiple departments with separate queues cause confusion',
    ],
    features: [
      { title: 'Self-Service Kiosk', description: 'Touch-screen kiosk replaces old ticket machines — citizens select their service and get a digital ticket.', icon: 'Tablet' },
      { title: 'Multi-Department', description: 'Documents, payments, registration — each department runs its own numbered queue.', icon: 'Building2' },
      { title: 'TV Display Boards', description: 'Large screens in the lobby show which tickets are being served at which counter.', icon: 'Monitor' },
      { title: 'Priority Service', description: 'Elderly, disabled, veterans, and pregnant women get priority with configurable categories.', icon: 'Shield' },
      { title: 'Appointment Booking', description: 'Citizens book online and skip the walk-in queue — interleaved automatically.', icon: 'Calendar' },
      { title: 'Branch Comparison', description: 'Public page shows wait times at all branches — citizens choose the least busy location.', icon: 'MapPin' },
    ],
    useCases: [
      { title: 'DMV Office', description: 'Citizens select their service (license renewal, registration, etc.) at the kiosk, fill intake forms on their phone, and wait comfortably until called to the right counter.' },
      { title: 'Multi-Branch Municipality', description: 'Citizens check wait times at all branches online and go to the shortest queue. Each branch manages its own departments and counters independently.' },
    ],
    stats: [
      { value: '50%', label: 'Reduction in perceived wait time' },
      { value: '3x', label: 'Faster than paper ticket systems' },
      { value: '90%', label: 'Citizen satisfaction rate' },
    ],
  },
  {
    id: 'banks',
    title: 'Banks & Financial Services',
    slug: 'banks',
    icon: 'Building',
    shortDescription: 'Streamline branch operations and reduce wait times',
    heroHeadline: 'Modern Banking Starts with Zero Wait Times',
    heroSubheadline: 'Customers join the queue before arriving, get served faster, and your tellers focus on service — not crowd management.',
    painPoints: [
      'Long queues drive customers to competitors',
      'Tellers spend time managing the line',
      'VIP customers wait alongside everyone else',
      'No visibility into branch performance',
    ],
    features: [
      { title: 'Virtual Queue', description: 'Customers join the queue from the mobile app before arriving at the branch.', icon: 'Smartphone' },
      { title: 'VIP Priority', description: 'Premium customers automatically get priority service with configurable rules.', icon: 'Crown' },
      { title: 'Service Routing', description: 'Route customers to the right teller based on service type — deposits, loans, accounts.', icon: 'GitBranch' },
      { title: 'Customer Identification', description: 'Intake forms capture account details before the customer reaches the counter.', icon: 'UserCheck' },
      { title: 'Multi-Branch Analytics', description: 'Compare performance across all branches — wait times, throughput, satisfaction.', icon: 'BarChart3' },
      { title: 'Appointment Scheduling', description: 'Customers book a slot for complex services like loan applications or account opening.', icon: 'CalendarClock' },
    ],
    useCases: [
      { title: 'Branch Visit', description: 'Customer opens the QR code outside, selects "Account Inquiry", joins the queue, and waits at the nearby coffee shop. Push notification arrives when the teller is ready.' },
      { title: 'Loan Application', description: 'Customer books an appointment online, fills out pre-visit forms, and arrives at the scheduled time — skipping the walk-in queue entirely.' },
    ],
    stats: [
      { value: '45%', label: 'Reduction in wait times' },
      { value: '30%', label: 'Increase in teller efficiency' },
      { value: '4.8/5', label: 'Customer satisfaction' },
    ],
  },
  {
    id: 'hotels',
    title: 'Hotels & Hospitality',
    slug: 'hotels',
    icon: 'Hotel',
    shortDescription: 'Elevate the guest experience from check-in to checkout',
    heroHeadline: 'Guest Experience Without the Wait',
    heroSubheadline: 'From check-in to concierge — manage every guest touchpoint with one seamless arrival and service flow.',
    painPoints: [
      'Long check-in/checkout lines frustrate guests',
      'Concierge services are first-come, first-served',
      'No way to manage pool/spa/restaurant queues',
      'VIP guests expect priority treatment',
    ],
    features: [
      { title: 'Check-In Queue', description: 'Guests join the check-in queue on arrival — wait in the lobby, not in line.', icon: 'DoorOpen' },
      { title: 'Concierge Services', description: 'Guests request concierge help from their phone — get notified when available.', icon: 'Concierge' },
      { title: 'Multi-Service', description: 'Manage queues for restaurant, spa, pool, room service — all from one dashboard.', icon: 'LayoutGrid' },
      { title: 'VIP Treatment', description: 'Loyalty members and suite guests automatically get priority service.', icon: 'Crown' },
      { title: 'TV Displays', description: 'Show queue status on lobby screens with your hotel branding.', icon: 'Monitor' },
      { title: 'Guest Feedback', description: 'Automatic satisfaction survey after each service interaction.', icon: 'MessageSquare' },
    ],
    useCases: [
      { title: 'Busy Check-In', description: 'Guests arrive during peak hours, scan the lobby QR code, complete pre-check-in forms on their phone, and relax in the lounge until called to the desk.' },
      { title: 'Spa & Pool', description: 'Guests join the spa queue from their room, continue their day, and get notified when a slot opens up.' },
    ],
    stats: [
      { value: '5 min', label: 'Average check-in time saved' },
      { value: '50%', label: 'Less lobby congestion' },
      { value: '4.9/5', label: 'Guest satisfaction' },
    ],
  },
  {
    id: 'barbershops',
    title: 'Barbershops & Salons',
    slug: 'barbershops',
    icon: 'Scissors',
    shortDescription: 'Modernize walk-ins, bookings, and chair availability in one flow',
    heroHeadline: 'Your Chair is Ready — No More Walk-In Chaos',
    heroSubheadline: 'Clients join digitally, see live timing, and show up when their barber or stylist is nearly ready.',
    painPoints: [
      'Walk-ins leave when they see a long wait',
      'Phone keeps ringing for "how long is the wait?"',
      'Paper sign-in sheets are unreliable',
      'Can\'t manage multiple barbers/stylists efficiently',
    ],
    features: [
      { title: 'Walk-In Flow', description: 'Clients scan a QR code on your door to enter the walk-in flow without calling ahead.', icon: 'QrCode' },
      { title: 'Live Wait Times', description: 'Clients see estimated wait time on their phone — no more "how long?" calls.', icon: 'Clock' },
      { title: 'Barber Selection', description: 'Clients can request a specific barber or join the general queue.', icon: 'User' },
      { title: 'Push Notifications', description: 'Free push notification when it\'s the client\'s turn — no SMS costs.', icon: 'Bell' },
      { title: 'Appointment Booking', description: 'Offer online booking for regulars alongside walk-in availability.', icon: 'Calendar' },
      { title: 'Client History', description: 'Track returning clients, visit frequency, and preferences.', icon: 'History' },
    ],
    useCases: [
      { title: 'Saturday Morning Rush', description: 'Clients scan the QR code on the shop window, enter the walk-in flow, and grab coffee next door. Push notification arrives when the chair is ready.' },
      { title: 'Regular Client', description: 'A returning client books their usual Saturday 10am slot online. They arrive on time and skip the walk-in queue.' },
    ],
    stats: [
      { value: '30%', label: 'Fewer walkouts' },
      { value: '0', label: 'Cost per notification' },
      { value: '2 min', label: 'Setup time' },
    ],
  },
  {
    id: 'pharmacies',
    title: 'Pharmacies',
    slug: 'pharmacies',
    icon: 'Pill',
    shortDescription: 'Reduce prescription wait times with digital queuing',
    heroHeadline: 'Prescriptions Ready? We\'ll Notify You.',
    heroSubheadline: 'Patients drop off prescriptions and leave — get a push notification when it\'s ready for pickup. No more waiting at the counter.',
    painPoints: [
      'Patients crowd the counter waiting for prescriptions',
      'Staff interrupted by "is it ready yet?" questions',
      'No way to communicate preparation time',
      'Confusion between drop-off and pickup queues',
    ],
    features: [
      { title: 'Prescription Intake', description: 'Patients submit their prescription and enter the pickup workflow without standing at the counter.', icon: 'FileText' },
      { title: 'Preparation Tracking', description: 'Patients see their prescription status in real-time: received, preparing, ready.', icon: 'Activity' },
      { title: 'Ready Notification', description: 'Free push notification when the prescription is ready for pickup.', icon: 'Bell' },
      { title: 'Pickup Queue', description: 'Separate queue for pickup — patients are called to the counter when their turn comes.', icon: 'PackageCheck' },
      { title: 'Priority Cases', description: 'Urgent prescriptions and elderly patients get priority automatically.', icon: 'Shield' },
      { title: 'Counter Display', description: 'TV screen shows which ticket numbers are ready and which counter to go to.', icon: 'Monitor' },
    ],
    useCases: [
      { title: 'Prescription Drop-Off', description: 'Patient drops off the prescription, scans the QR code, and leaves to run errands. 20 minutes later, they get a push notification that it\'s ready.' },
      { title: 'Busy Pharmacy', description: 'Multiple pharmacists work in parallel. The TV display shows which prescriptions are ready and at which counter to pick up.' },
    ],
    stats: [
      { value: '70%', label: 'Less counter congestion' },
      { value: '15 min', label: 'Average time saved per patient' },
      { value: '95%', label: 'Patient satisfaction' },
    ],
  },
];

export function getSolutionBySlug(slug: string): Solution | undefined {
  return solutions.find((s) => s.slug === slug);
}

export function getAllSolutionSlugs(): string[] {
  return solutions.map((s) => s.slug);
}
