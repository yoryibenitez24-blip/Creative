// Store templates: 26 original, complete multi-page stores across niches. Product names and prices are
// generic samples; every image is procedural art (src/store/art.js) — no photos, no network.
//
//   STORE_TEMPLATES: [{ id, name, niche, category, description, swatch: [bg, fg, accent] }]
//   createStore(templateId?) → a normalised store document ready for the builder
//   TEMPLATE_CATEGORIES: category filter values for the gallery

import { gen } from './art.js';
import { normalizeStore, slugify, uid } from './model.js';

const S = (type, settings = {}) => ({ type, settings });
const SIZES = ['XS', 'S', 'M', 'L', 'XL'], SML = ['S', 'M', 'L'];

// Shared copy blocks
const Q = (a, b, c) => [{ quote: a[0], name: a[1], role: a[2] || 'Verified buyer' }, { quote: b[0], name: b[1], role: b[2] || 'Verified buyer' }, { quote: c[0], name: c[1], role: c[2] || 'Verified buyer' }];
const FAQ_SHIP = [{ q: 'How long does delivery take?', a: 'Orders are packed within 1–2 business days. Delivery usually takes 3–5 business days.' }, { q: 'What is your return policy?', a: 'Unused items can be returned within 30 days. Contact us and we will guide you through it.' }, { q: 'How do I pay?', a: 'Place your order through the checkout and we confirm payment details with you directly.' }];
const FEAT_SHOP = [{ icon: 'truck', title: 'Fast shipping', text: 'Packed within two business days.' }, { icon: 'refresh', title: 'Easy returns', text: '30 days to change your mind.' }, { icon: 'chat', title: 'Real support', text: 'Questions? Message us any time.' }];
const FEAT_DIGITAL = [{ icon: 'bolt', title: 'Instant access', text: 'Start the moment your order is confirmed.' }, { icon: 'refresh', title: 'Lifetime updates', text: 'Every future update included.' }, { icon: 'chat', title: 'Community', text: 'Learn alongside other members.' }];

/*
 Template definition:
   theme (partial), art: [background, accent] for product art, swatches: product colours,
   heroArt: art kind for wide hero images, products: [title, price, compareAt|0, artKind, category, options?, extra?]
   home: section list, plus optional about / contact / checkout / currency / announcement / social overrides.
*/
const T = [];
const def = d => T.push(d);

def({
  id: 'gym', name: 'Ironclad', niche: 'Gym / fitness', category: 'Fitness & sport', description: 'Bold, dark gym brand with memberships, gear and class timetable.',
  theme: { colors: { background: '#0e0e10', surface: '#1a1a1e', text: '#f4f4f5', muted: '#a1a1aa', primary: '#ef233c', primaryText: '#ffffff', accent: '#ef233c', border: '#2a2a30' }, fonts: { heading: 'impact', body: 'helvetica' }, headingWeight: 800, headingCase: 'uppercase', radius: 2, buttons: 'sharp', density: 'comfortable', headerStyle: 'left', cardStyle: 'card' },
  art: ['#1c1c22', '#ef233c'], swatches: ['#3f3f46', '#e4e4e7', '#ef233c', '#71717a'], heroArt: 'dumbbell',
  products: [['Hex Dumbbell Pair', 89, 0, 'dumbbell', 'Equipment', { Weight: ['5 kg', '10 kg', '15 kg'] }], ['Competition Kettlebell', 64, 79, 'kettlebell', 'Equipment', { Weight: ['12 kg', '16 kg', '24 kg'] }], ['Resistance Band Set', 29, 0, 'band', 'Equipment'], ['Shaker Bottle 700 ml', 14, 0, 'shaker', 'Accessories'], ['Training Tee', 32, 0, 'tshirt', 'Apparel', { Size: SIZES, Color: ['Black', 'Red'] }], ['Heavyweight Hoodie', 64, 0, 'hoodie', 'Apparel', { Size: SIZES }], ['Gym Duffel', 58, 0, 'bag', 'Accessories'], ['Lifting Cap', 24, 0, 'cap', 'Apparel']],
  home: [S('hero', { layout: 'image', eyebrow: 'Open 24/7', heading: 'Stronger every single day', text: 'Coached classes, open gym and gear built for hard training.', buttonLabel: 'See memberships', buttonLink: '#plans', button2Label: 'Shop gear', button2Link: 'collection:all', overlay: 55 }),
    S('features', { items: [{ icon: 'clock', title: '24/7 access', text: 'Train on your schedule.' }, { icon: 'users', title: 'Coached classes', text: '40+ classes every week.' }, { icon: 'award', title: 'Certified coaches', text: 'Programs that get results.' }] }),
    S('pricing', { heading: 'Memberships', plans: [{ name: 'Open Gym', price: '39', period: '/ month', features: '24/7 gym floor\nLocker room\nApp workouts', buttonLabel: 'Join now', buttonLink: 'page:contact' }, { name: 'Unlimited', price: '69', period: '/ month', features: 'Everything in Open Gym\nUnlimited classes\nBody scan every month', buttonLabel: 'Join now', buttonLink: 'page:contact', highlight: true }, { name: 'Personal', price: '149', period: '/ month', features: 'Everything in Unlimited\n4 personal sessions\nNutrition plan', buttonLabel: 'Book a call', buttonLink: 'page:contact' }] }),
    S('featured-products', { heading: 'Train-ready gear', columns: 4 }), S('countdown', { heading: 'New-member week', text: 'Sign up this week and your first month is half price.', buttonLabel: 'Claim offer', buttonLink: 'page:contact' }),
    S('testimonials', { items: Q(['Best coaching I have had in ten years of lifting.', 'Marcus T.', 'Member since 2021'], ['The classes are brutal in the best way.', 'Dana W.', 'Unlimited member'], ['Clean, friendly and always open.', 'Kofi A.', 'Open Gym member']) }),
    S('locations', { heading: 'Find us', items: [{ name: 'Ironclad Downtown', address: '200 Foundry Lane', hours: 'Open 24/7\nStaffed 6:00–22:00', phone: '+1 555 0100' }] })],
  announcement: 'New-member week: first month half price',
});

def({
  id: 'course', name: 'Lumen Academy', niche: 'Online course', category: 'Education', description: 'Bright course platform with curriculum, plans and FAQ.',
  theme: { colors: { background: '#ffffff', surface: '#f3f2ff', text: '#14123a', muted: '#5e5b80', primary: '#4f46e5', primaryText: '#ffffff', accent: '#4f46e5', border: '#e4e2f7' }, fonts: { heading: 'system', body: 'system' }, headingWeight: 800, radius: 14, buttons: 'pill', headerStyle: 'left', cardStyle: 'card', imageRatio: 'landscape' },
  art: ['#eceaff', '#f59e0b'], swatches: ['#4f46e5', '#0ea5e9', '#14b8a6', '#ec4899'], heroArt: 'play',
  products: [['Design Foundations', 129, 199, 'play', 'Courses'], ['Photography Masterclass', 149, 0, 'camera', 'Courses'], ['Creative Writing Lab', 99, 0, 'book', 'Courses'], ['Course Bundle — All Access', 349, 477, 'grid', 'Bundles', null, { featured: true }], ['1:1 Mentoring Session', 89, 0, 'chat', 'Mentoring', { Length: ['30 min', '60 min'] }], ['Workbook (PDF)', 19, 0, 'file', 'Resources']],
  home: [S('hero', { layout: 'split', eyebrow: 'Self-paced online courses', heading: 'Learn skills you will actually use', text: 'Short video lessons, real projects and feedback from working professionals.', buttonLabel: 'Browse courses', buttonLink: 'collection:all', button2Label: 'See the curriculum', button2Link: '#curriculum' }),
    S('logos', { heading: 'Students from', items: [{ name: 'Brightside' }, { name: 'Northwave' }, { name: 'Kinetic' }, { name: 'Papertrail' }] }),
    S('featured-products', { heading: 'Popular courses', columns: 3 }), S('curriculum', { heading: 'Inside Design Foundations', text: '6 modules · 42 lessons · 9 hours of video', modules: [{ title: 'Seeing like a designer', duration: '1 h 10 min', lessons: 'Welcome & setup\nVisual hierarchy\nThe grid\nAssignment: poster' }, { title: 'Type that works', duration: '1 h 35 min', lessons: 'Choosing typefaces\nPairing fonts\nSpacing & rhythm' }, { title: 'Colour with confidence', duration: '1 h 20 min', lessons: 'Colour models\nBuilding a palette\nContrast & accessibility' }, { title: 'Final project', duration: '2 h', lessons: 'Brief\nCritique\nPortfolio presentation' }] }),
    S('features', { heading: 'Why learners stay', items: FEAT_DIGITAL }), S('pricing', { heading: 'Simple pricing', plans: [{ name: 'Single course', price: '129', period: 'one-time', features: 'One course of your choice\nLifetime access\nCertificate', buttonLabel: 'Choose a course', buttonLink: 'collection:all' }, { name: 'All Access', price: '349', period: 'one-time', features: 'Every course, forever\nNew courses included\nPrivate community', buttonLabel: 'Get All Access', buttonLink: 'collection:all', highlight: true }] }),
    S('testimonials', { items: Q(['I landed my first freelance client after module four.', 'Aisha B.', 'Student'], ['Clear, practical and genuinely fun.', 'Tom H.', 'Student'], ['The feedback on my projects was worth it alone.', 'Mei L.', 'Student']) }),
    S('faq', { items: [{ q: 'How long do I have access?', a: 'Forever. Watch at your own pace and revisit any time.' }, { q: 'Do I need experience?', a: 'No. Every course starts from the basics.' }, { q: 'How do I receive the course after ordering?', a: 'We email your login within one business day after confirming your order.' }] })],
  checkout: 'email',
});

def({
  id: 'trading', name: 'Candle & Chart', niche: 'Trading course', category: 'Education', description: 'Dark, data-driven trading education with risk-first messaging.',
  theme: { colors: { background: '#0b1220', surface: '#111a2e', text: '#e6edf7', muted: '#8b9ab5', primary: '#22c55e', primaryText: '#04130a', accent: '#22c55e', border: '#1e2a44' }, fonts: { heading: 'mono', body: 'system' }, headingWeight: 700, radius: 6, buttons: 'solid', headerStyle: 'left', cardStyle: 'bordered', imageRatio: 'landscape' },
  art: ['#0f1a30', '#22c55e'], swatches: ['#1e293b', '#334155', '#0f766e', '#1d4ed8'], heroArt: 'chart',
  products: [['Price Action Fundamentals', 197, 0, 'chart', 'Courses'], ['Risk Management Bootcamp', 147, 0, 'target', 'Courses'], ['Swing Trading System', 297, 397, 'chart', 'Courses', null, { featured: true }], ['Trading Journal Template', 29, 0, 'file', 'Tools'], ['Weekly Market Review (monthly)', 39, 0, 'play', 'Memberships']],
  home: [S('hero', { layout: 'gradient', eyebrow: 'Education, not signals', heading: 'Trade with a plan, not a hunch', text: 'Structured lessons on price action, risk and psychology — taught by traders who journal every trade.', buttonLabel: 'Explore courses', buttonLink: 'collection:all', button2Label: 'Curriculum', button2Link: '#curriculum' }),
    S('features', { items: [{ icon: 'shield', title: 'Risk first', text: 'Position sizing before entries.' }, { icon: 'play', title: '60+ lessons', text: 'Short, focused video modules.' }, { icon: 'users', title: 'Live reviews', text: 'Weekly chart breakdowns.' }] }),
    S('featured-products', { heading: 'Programs', columns: 3 }), S('curriculum', { heading: 'Swing Trading System — curriculum', modules: [{ title: 'Market structure', duration: '1 h 30 min', lessons: 'Trends & ranges\nSupport and resistance\nTimeframes' }, { title: 'Entries & exits', duration: '2 h', lessons: 'Setups\nStops\nTaking profit' }, { title: 'Risk & psychology', duration: '1 h 45 min', lessons: 'Position sizing\nDrawdowns\nJournaling' }] }),
    S('countdown', { heading: 'Cohort enrolment closes in', text: 'Live sessions start with the next cohort.', buttonLabel: 'Enrol now', buttonLink: 'collection:all' }),
    S('testimonials', { items: Q(['Finally a course that talks about risk before profits.', 'Rahul S.', 'Student'], ['The journal template changed how I review trades.', 'Elena V.', 'Student'], ['Clear, honest and no hype.', 'Chris D.', 'Student']) }),
    S('faq', { items: [{ q: 'Do you guarantee profits?', a: 'No. Trading involves substantial risk of loss. Our courses are educational and are not financial advice.' }, { q: 'Which markets are covered?', a: 'The concepts apply to stocks, forex and crypto charts.' }, { q: 'Is there a refund?', a: 'Yes — 14 days if you have watched less than 20% of the course.' }] }),
    S('rich-text', { heading: 'Risk disclaimer', text: 'Trading financial instruments carries a high level of risk and may not be suitable for all investors. Past performance is not indicative of future results. Nothing on this site is investment advice.', align: 'left' })],
  checkout: 'paymentLinks', announcement: 'Next live cohort starts soon — limited seats',
});

def({
  id: 'coaching', name: 'North Star Coaching', niche: 'Coaching', category: 'Services', description: 'Warm, editorial coaching site with packages and testimonials.',
  theme: { colors: { background: '#f7f1ea', surface: '#efe5d8', text: '#2b2118', muted: '#7a6a5a', primary: '#2b2118', primaryText: '#f7f1ea', accent: '#c26a3d', border: '#e2d5c4' }, fonts: { heading: 'garamond', body: 'georgia' }, headingWeight: 500, radius: 0, buttons: 'outline', density: 'airy', headerStyle: 'centered', imageRatio: 'portrait' },
  art: ['#efe5d8', '#c26a3d'], swatches: ['#2b2118', '#7a6a5a', '#c26a3d'], heroArt: 'target',
  products: [['Clarity Session (90 min)', 180, 0, 'target', 'Sessions'], ['3-Month Coaching Package', 1200, 1440, 'award', 'Packages', null, { featured: true }], ['Leadership Intensive (1 day)', 950, 0, 'users', 'Packages'], ['Goal-Setting Workbook', 24, 0, 'book', 'Resources']],
  home: [S('hero', { layout: 'split', eyebrow: 'Career & life coaching', heading: 'Find your direction. Then move.', text: 'One-to-one coaching for people ready to make their next chapter intentional.', buttonLabel: 'Book a clarity session', buttonLink: 'collection:all', button2Label: 'How it works', button2Link: 'page:about' }),
    S('image-text', { heading: 'Hi, I am your coach', text: 'For twelve years I have helped founders, managers and career-changers find clarity and act on it. My approach is practical, warm and honest.', buttonLabel: 'My story', buttonLink: 'page:about' }),
    S('pricing', { heading: 'Ways to work together', plans: [{ name: 'Clarity Session', price: '180', period: 'single', features: '90-minute deep dive\nWritten action plan\nOne follow-up email', buttonLabel: 'Book', buttonLink: 'collection:all' }, { name: '3-Month Package', price: '1200', period: 'total', features: '6 sessions\nMessaging support\nWorkbook included', buttonLabel: 'Start', buttonLink: 'collection:all', highlight: true }, { name: 'Leadership Intensive', price: '950', period: 'day', features: 'Full-day workshop\nTeam assessment\n30-day check-in', buttonLabel: 'Enquire', buttonLink: 'page:contact' }] }),
    S('testimonials', { items: Q(['I left my first session with a plan I actually followed.', 'Hannah P.', 'Product manager'], ['Calm, sharp and kind. Exactly what I needed.', 'Jorge M.', 'Founder'], ['Three months that changed my career.', 'Olivia K.', 'Designer']) }),
    S('faq', { items: [{ q: 'Where do sessions happen?', a: 'Online by video call, or in person in the studio.' }, { q: 'How do I book?', a: 'Choose a package and send the order — I reply within a day to schedule.' }] }), S('newsletter', { heading: 'Monthly letter', text: 'One thoughtful note a month on focus, work and change.' })],
  checkout: 'email',
});

def({
  id: 'merch', name: 'Static Noise', niche: 'Merch / streetwear', category: 'Fashion', description: 'Loud streetwear drop store with countdown and grid.',
  theme: { colors: { background: '#f2f2ee', surface: '#e4e4dd', text: '#0a0a0a', muted: '#5a5a55', primary: '#0a0a0a', primaryText: '#d9ff3f', accent: '#d9ff3f', border: '#0a0a0a' }, fonts: { heading: 'impact', body: 'mono' }, headingWeight: 900, headingCase: 'uppercase', radius: 0, buttons: 'sharp', density: 'compact', headerStyle: 'centered', cardStyle: 'bordered', imageRatio: 'portrait' },
  art: ['#e4e4dd', '#d9ff3f'], swatches: ['#0a0a0a', '#f2f2ee', '#6b7280', '#d9ff3f'], heroArt: 'hoodie',
  products: [['Static Logo Tee', 35, 0, 'tshirt', 'Tees', { Size: SIZES, Color: ['Black', 'Bone'] }], ['Noise Hoodie', 85, 0, 'hoodie', 'Hoodies', { Size: SIZES }], ['Signal Cap', 30, 0, 'cap', 'Accessories'], ['Feedback Tote', 22, 0, 'tote', 'Accessories'], ['Distortion Jacket', 140, 175, 'jacket', 'Outerwear', { Size: SML }], ['Frequency Tee', 35, 0, 'tshirt', 'Tees', { Size: SIZES }], ['Low Hum Beanie', 28, 0, 'cap', 'Accessories']],
  home: [S('hero', { layout: 'image', eyebrow: 'Drop 07', heading: 'Turn it up', text: 'Limited run. No restocks.', buttonLabel: 'Shop the drop', buttonLink: 'collection:all', align: 'center', overlay: 30 }),
    S('countdown', { heading: 'Drop 08 lands in', text: 'Sign up to get the link first.', buttonLabel: 'Notify me', buttonLink: '#newsletter' }), S('product-carousel', { heading: 'Fresh off the press' }),
    S('featured-products', { heading: 'Core', columns: 4 }), S('insta-grid', { heading: 'Seen on the street', handle: '@staticnoise' }), S('newsletter', { heading: 'Get on the list', text: 'Drop alerts only. Never spam.' })],
  announcement: 'Free shipping on drops over $100',
});

def({
  id: 'boutique', name: 'Maison Clair', niche: 'Clothing boutique', category: 'Fashion', description: 'Soft, editorial boutique with lookbook feel.',
  theme: { colors: { background: '#fbf8f4', surface: '#f1ebe3', text: '#2a2522', muted: '#857a70', primary: '#2a2522', primaryText: '#fbf8f4', accent: '#a8754f', border: '#e7ded3' }, fonts: { heading: 'didone', body: 'helvetica' }, headingWeight: 400, radius: 0, buttons: 'solid', density: 'airy', headerStyle: 'centered', imageRatio: 'portrait' },
  art: ['#f1ebe3', '#a8754f'], swatches: ['#d6c3ad', '#2a2522', '#9fb2a0', '#c9a7a0'], heroArt: 'dress',
  products: [['Linen Wrap Dress', 148, 0, 'dress', 'Dresses', { Size: SIZES, Color: ['Sand', 'Sage'] }], ['Silk Slip Dress', 168, 210, 'dress', 'Dresses', { Size: SIZES }], ['Relaxed Linen Shirt', 98, 0, 'tshirt', 'Tops', { Size: SIZES }], ['Cropped Wool Jacket', 245, 0, 'jacket', 'Outerwear', { Size: SML }], ['Leather Market Tote', 135, 0, 'tote', 'Accessories'], ['Pearl Drop Earrings', 58, 0, 'earrings', 'Accessories']],
  home: [S('hero', { layout: 'split', eyebrow: 'Spring collection', heading: 'Quiet pieces, made to last', text: 'Natural fabrics, considered cuts and a palette you can wear every day.', buttonLabel: 'Shop new in', buttonLink: 'collection:all' }),
    S('collection-list', { heading: 'Shop by category', columns: 3 }), S('featured-products', { heading: 'New in', columns: 4 }),
    S('image-text', { heading: 'Made in small batches', text: 'Every piece is cut in a family-run atelier and finished by hand. We make less, and make it better.', buttonLabel: 'Our story', buttonLink: 'page:about', imageSide: 'right' }),
    S('insta-grid', { heading: 'Worn by you', handle: '@maisonclair' }), S('newsletter', { heading: 'Letters from the atelier', text: 'New collections and private sales.' })],
  currency: ['EUR', 'fr-FR'],
});

def({
  id: 'sneakers', name: 'Solegrid', niche: 'Sneakers', category: 'Fashion', description: 'Energetic sneaker store with carousel hero and size pickers.',
  theme: { colors: { background: '#ffffff', surface: '#f4f4f4', text: '#111111', muted: '#6b6b6b', primary: '#ff5a1f', primaryText: '#ffffff', accent: '#ff5a1f', border: '#e6e6e6' }, fonts: { heading: 'grotesk', body: 'helvetica' }, headingWeight: 900, headingCase: 'uppercase', radius: 12, buttons: 'pill', headerStyle: 'left', cardStyle: 'card' },
  art: ['#f4f4f4', '#ff5a1f'], swatches: ['#111111', '#ffffff', '#2563eb', '#16a34a', '#ff5a1f'], heroArt: 'sneaker',
  products: [['Runner One', 129, 0, 'sneaker', 'Running', { Size: ['40', '41', '42', '43', '44', '45'], Color: ['Black', 'White'] }], ['Court Classic', 99, 0, 'sneaker', 'Lifestyle', { Size: ['40', '41', '42', '43', '44'] }], ['Trail Grip', 149, 169, 'sneaker', 'Running', { Size: ['41', '42', '43', '44'] }], ['High Top Canvas', 79, 0, 'boot', 'Lifestyle', { Size: ['39', '40', '41', '42', '43'] }], ['Everyday Sock 3-Pack', 18, 0, 'box', 'Accessories'], ['Sneaker Care Kit', 24, 0, 'bottle', 'Accessories']],
  home: [S('hero', { layout: 'carousel', heading: 'Built to move', slides: [{ heading: 'Runner One', text: 'Light, fast, everyday.', buttonLabel: 'Shop running', buttonLink: 'collection:all' }, { heading: 'Court Classic', text: 'The low-top that goes with everything.', buttonLabel: 'Shop lifestyle', buttonLink: 'collection:all' }], overlay: 25 }),
    S('product-carousel', { heading: 'Just dropped' }), S('features', { items: [{ icon: 'truck', title: 'Free delivery', text: 'On all orders over $75.' }, { icon: 'refresh', title: 'Free size swaps', text: 'Wrong size? We swap it.' }, { icon: 'shield', title: '2-year warranty', text: 'On every pair.' }] }),
    S('banner', { heading: 'Members get 10% off', text: 'Join the Solegrid crew — it is free.', buttonLabel: 'Join now', buttonLink: '#newsletter', style: 'solid' }), S('featured-products', { heading: 'Best sellers', columns: 4 }), S('newsletter')],
});

def({
  id: 'furniture', name: 'Oak & Row', niche: 'Furniture', category: 'Home & living', description: 'Calm furniture showroom with collections and craft story.',
  theme: { colors: { background: '#f6f3ee', surface: '#ebe5dc', text: '#2d2a26', muted: '#7d766c', primary: '#3b4a3f', primaryText: '#f6f3ee', accent: '#b07d4f', border: '#ddd5c9' }, fonts: { heading: 'georgia', body: 'helvetica' }, headingWeight: 400, radius: 4, buttons: 'solid', density: 'airy', headerStyle: 'left', imageRatio: 'landscape' },
  art: ['#ebe5dc', '#b07d4f'], swatches: ['#8b6b4a', '#3b4a3f', '#c2a27c', '#5c5c5c'], heroArt: 'sofa',
  products: [['Haven 3-Seat Sofa', 1490, 0, 'sofa', 'Living room', { Fabric: ['Oat', 'Moss', 'Charcoal'] }], ['Row Dining Table', 980, 0, 'table', 'Dining', { Size: ['160 cm', '200 cm'] }], ['Arc Lounge Chair', 540, 620, 'chair', 'Living room'], ['Halo Floor Lamp', 260, 0, 'lamp', 'Lighting'], ['Oak Side Table', 190, 0, 'table', 'Living room'], ['Linen Cushion', 45, 0, 'cushion', 'Textiles', { Color: ['Oat', 'Rust', 'Sage'] }]],
  home: [S('hero', { layout: 'image', heading: 'Furniture for slow living', text: 'Solid wood, natural fabrics, built to be handed down.', buttonLabel: 'Shop the collection', buttonLink: 'collection:all', overlay: 30 }),
    S('collection-list', { heading: 'Rooms', columns: 3 }), S('featured-products', { heading: 'Signature pieces', columns: 3 }),
    S('image-text', { heading: 'Crafted in our workshop', text: 'Every table and chair is built from FSC-certified oak and finished with natural oils.', buttonLabel: 'Visit the workshop', buttonLink: 'page:about' }),
    S('testimonials', { items: Q(['The sofa is even better in person.', 'Grace N.'], ['Solid, beautiful and delivered with care.', 'Peter J.'], ['Our table is the heart of the house now.', 'Amara O.']) }), S('features', { items: FEAT_SHOP })],
  announcement: 'White-glove delivery included on furniture',
});

def({
  id: 'homedecor', name: 'Nest Theory', niche: 'Home decor', category: 'Home & living', description: 'Earthy decor shop with gallery and gifts.',
  theme: { colors: { background: '#fdf8f3', surface: '#f3e7dc', text: '#3a2f2a', muted: '#8a7568', primary: '#c0603d', primaryText: '#ffffff', accent: '#6f8f72', border: '#ead9cb' }, fonts: { heading: 'palatino', body: 'verdana' }, headingWeight: 600, radius: 18, buttons: 'pill', headerStyle: 'centered', cardStyle: 'plain', imageRatio: 'portrait' },
  art: ['#f3e7dc', '#6f8f72'], swatches: ['#c0603d', '#6f8f72', '#e2c9a6', '#3a2f2a'], heroArt: 'vase',
  products: [['Terracotta Vase', 42, 0, 'vase', 'Vases', { Size: ['Small', 'Large'] }], ['Stoneware Mug Set', 36, 0, 'mug', 'Kitchen'], ['Soy Candle — Fig', 28, 0, 'candle', 'Candles', { Scent: ['Fig', 'Cedar', 'Linen'] }], ['Woven Cushion Cover', 34, 40, 'cushion', 'Textiles'], ['Ceramic Table Lamp', 89, 0, 'lamp', 'Lighting'], ['Bud Vase Trio', 32, 0, 'vase', 'Vases']],
  home: [S('hero', { layout: 'split', eyebrow: 'Handmade homewares', heading: 'Make home feel like you', text: 'Small-batch ceramics, candles and textiles.', buttonLabel: 'Shop decor', buttonLink: 'collection:all' }),
    S('featured-products', { heading: 'Loved this month', columns: 3 }), S('gallery', { heading: 'In real homes', columns: 3 }),
    S('banner', { heading: 'The gift guide is here', text: 'Thoughtful pieces under $50.', buttonLabel: 'Find a gift', buttonLink: 'collection:all', style: 'image' }), S('features', { items: FEAT_SHOP }), S('newsletter')],
});

def({
  id: 'general', name: 'Everyday Goods', niche: 'General store', category: 'General', description: 'Clean all-purpose shop for any catalogue.',
  theme: { colors: { background: '#ffffff', surface: '#f2f5f9', text: '#0f172a', muted: '#64748b', primary: '#2563eb', primaryText: '#ffffff', accent: '#2563eb', border: '#e2e8f0' }, fonts: { heading: 'system', body: 'system' }, headingWeight: 700, radius: 10, buttons: 'solid', headerStyle: 'left', cardStyle: 'card' },
  art: ['#eef2f7', '#2563eb'], swatches: ['#2563eb', '#0f172a', '#10b981', '#f59e0b', '#ef4444'], heroArt: 'box',
  products: [['Insulated Bottle', 29, 0, 'bottle', 'Kitchen', { Color: ['Blue', 'Black', 'Green'] }], ['Everyday Backpack', 79, 95, 'backpack', 'Bags'], ['Wireless Earbuds', 59, 0, 'headphones', 'Tech'], ['Ceramic Mug', 16, 0, 'mug', 'Kitchen'], ['Canvas Tote', 19, 0, 'tote', 'Bags'], ['Desk Lamp', 45, 0, 'lamp', 'Home'], ['Notebook Set', 14, 0, 'book', 'Stationery'], ['Phone Stand', 22, 0, 'phone', 'Tech']],
  home: [S('hero', { layout: 'image', heading: 'Good things for every day', text: 'Useful, well-made products at fair prices.', buttonLabel: 'Shop all', buttonLink: 'collection:all', overlay: 40 }),
    S('collection-list', { heading: 'Shop by category', columns: 4 }), S('featured-products', { heading: 'Featured', columns: 4 }), S('features', { items: FEAT_SHOP }),
    S('logos', { heading: 'As seen in' }), S('faq', { items: FAQ_SHIP }), S('newsletter')],
});

def({
  id: 'electronics', name: 'Voltline', niche: 'Electronics', category: 'Tech', description: 'Sleek dark tech store with specs-led product cards.',
  theme: { colors: { background: '#0c0f14', surface: '#151a22', text: '#e8edf3', muted: '#8a96a8', primary: '#22d3ee', primaryText: '#04161a', accent: '#22d3ee', border: '#222a36' }, fonts: { heading: 'helvetica', body: 'system' }, headingWeight: 700, radius: 14, buttons: 'pill', headerStyle: 'left', cardStyle: 'card' },
  art: ['#141a24', '#22d3ee'], swatches: ['#cbd5e1', '#334155', '#22d3ee', '#f8fafc'], heroArt: 'headphones',
  products: [['Pulse Wireless Headphones', 199, 249, 'headphones', 'Audio', { Color: ['Graphite', 'Silver'] }], ['Arc Bluetooth Speaker', 129, 0, 'speaker', 'Audio'], ['Volt 14 Laptop Sleeve', 39, 0, 'laptop', 'Accessories'], ['Orbit Smartwatch', 249, 0, 'watch', 'Wearables', { Size: ['41 mm', '45 mm'] }], ['Snap Phone Case', 29, 0, 'phone', 'Accessories'], ['Lens Mirrorless Camera', 899, 999, 'camera', 'Cameras']],
  home: [S('hero', { layout: 'gradient', eyebrow: 'New', heading: 'Sound, sharpened', text: 'Pulse wireless headphones with 40-hour battery.', buttonLabel: 'Shop Pulse', buttonLink: 'collection:all', button2Label: 'All products', button2Link: 'collection:all' }),
    S('product-carousel', { heading: 'Trending now' }), S('features', { heading: 'Why Voltline', columns: 4, items: [{ icon: 'truck', title: 'Next-day shipping', text: 'Order by 3 pm.' }, { icon: 'shield', title: '2-year warranty', text: 'On all devices.' }, { icon: 'refresh', title: '30-day returns', text: 'No questions.' }, { icon: 'chat', title: 'Expert help', text: 'Real people, fast answers.' }] }),
    S('banner', { heading: 'Trade in, trade up', text: 'Get credit for your old device.', buttonLabel: 'Learn more', buttonLink: 'page:contact', style: 'solid' }), S('featured-products', { heading: 'Best sellers', columns: 3 }), S('faq', { items: FAQ_SHIP })],
});

def({
  id: 'skincare', name: 'Dew Ritual', niche: 'Beauty / skincare', category: 'Beauty', description: 'Soft blush skincare brand with ingredient story.',
  theme: { colors: { background: '#fff8f6', surface: '#fbe9e4', text: '#3d2a2a', muted: '#9a7b78', primary: '#3d2a2a', primaryText: '#fff8f6', accent: '#e38b7c', border: '#f2dcd6' }, fonts: { heading: 'didone', body: 'helvetica' }, headingWeight: 400, radius: 24, buttons: 'pill', density: 'airy', headerStyle: 'centered', imageRatio: 'portrait' },
  art: ['#fbe9e4', '#e38b7c'], swatches: ['#f4c7bd', '#ffffff', '#e8d5c4', '#d9a5a0'], heroArt: 'serum',
  products: [['Glow Vitamin C Serum', 48, 0, 'serum', 'Serums', { Size: ['15 ml', '30 ml'] }], ['Cloud Moisturiser', 42, 0, 'jar', 'Moisturisers'], ['Gentle Gel Cleanser', 26, 0, 'bottle', 'Cleansers'], ['Night Repair Oil', 54, 64, 'serum', 'Serums'], ['Barrier Balm', 32, 0, 'jar', 'Moisturisers'], ['The Ritual Set', 119, 142, 'box', 'Sets', null, { featured: true }]],
  home: [S('hero', { layout: 'split', eyebrow: 'Clean, clinical, kind', heading: 'Skin that feels like you again', text: 'Gentle formulas with proven actives.', buttonLabel: 'Find your ritual', buttonLink: 'collection:all' }),
    S('featured-products', { heading: 'The essentials', columns: 3 }), S('features', { items: [{ icon: 'leaf', title: 'Vegan', text: 'No animal ingredients, ever.' }, { icon: 'heart', title: 'Cruelty-free', text: 'Never tested on animals.' }, { icon: 'shield', title: 'Dermatologist tested', text: 'Suitable for sensitive skin.' }] }),
    S('image-text', { heading: 'What is inside matters', text: 'Every formula lists every ingredient and its percentage. No fragrance, no fillers.', imageSide: 'right' }),
    S('testimonials', { items: Q(['My skin has never been calmer.', 'Nadia F.'], ['The serum is a game-changer.', 'Lucy T.'], ['Gentle and actually effective.', 'Ivy C.']) }), S('newsletter', { heading: 'Join the ritual', text: '10% off your first order.' })],
  currency: ['GBP', 'en-GB'],
});

def({
  id: 'jewelry', name: 'Aurelia', niche: 'Jewelry', category: 'Fashion', description: 'Black-and-gold fine jewellery boutique.',
  theme: { colors: { background: '#0f0d0b', surface: '#1a1714', text: '#f3ece1', muted: '#a89a86', primary: '#c9a45c', primaryText: '#0f0d0b', accent: '#c9a45c', border: '#2c2620' }, fonts: { heading: 'didone', body: 'garamond' }, headingWeight: 400, headingCase: 'uppercase', radius: 0, buttons: 'outline', density: 'airy', headerStyle: 'centered', imageRatio: 'square' },
  art: ['#1a1714', '#c9a45c'], swatches: ['#c9a45c', '#e5e4e2', '#b76e79'], heroArt: 'ring',
  products: [['Solitaire Ring', 420, 0, 'ring', 'Rings', { Metal: ['Gold', 'Platinum'], Size: ['5', '6', '7', '8'] }], ['Halo Pendant', 280, 0, 'necklace', 'Necklaces', { Metal: ['Gold', 'Rose gold'] }], ['Petite Hoops', 160, 0, 'earrings', 'Earrings'], ['Eternity Band', 520, 650, 'ring', 'Rings', { Size: ['5', '6', '7', '8'] }], ['Pearl Strand', 340, 0, 'necklace', 'Necklaces'], ['Signet Ring', 240, 0, 'ring', 'Rings']],
  home: [S('hero', { layout: 'image', heading: 'Heirlooms, made today', text: 'Recycled gold. Ethically sourced stones.', buttonLabel: 'Discover', buttonLink: 'collection:all', align: 'center', overlay: 45 }),
    S('collection-list', { heading: 'Collections', columns: 3 }), S('featured-products', { heading: 'Signature pieces', columns: 3 }), S('rich-text', { heading: 'Made by hand', text: 'Each piece is cast, set and polished by our goldsmiths. Complimentary engraving and lifetime care.' }),
    S('testimonials', { items: Q(['The ring is breathtaking.', 'Claire D.'], ['Beautiful packaging and service.', 'Andrew L.'], ['A piece I will wear forever.', 'Sofia R.']) })],
  announcement: 'Complimentary engraving on every order',
});

def({
  id: 'coffee', name: 'Ember Roasters', niche: 'Coffee roaster', category: 'Food & drink', description: 'Warm specialty coffee with grind & size options.',
  theme: { colors: { background: '#faf6f0', surface: '#efe4d6', text: '#2a1d15', muted: '#7d6656', primary: '#6b3e26', primaryText: '#faf6f0', accent: '#d9822b', border: '#e4d5c3' }, fonts: { heading: 'condensed', body: 'georgia' }, headingWeight: 800, headingCase: 'uppercase', radius: 6, buttons: 'solid', headerStyle: 'left', cardStyle: 'plain', imageRatio: 'portrait' },
  art: ['#efe4d6', '#d9822b'], swatches: ['#6b3e26', '#2a1d15', '#a35c2e', '#3f5b3a'], heroArt: 'coffeebag',
  products: [['Ember House Blend', 16, 0, 'coffeebag', 'Coffee', { Size: ['250 g', '1 kg'], Grind: ['Whole bean', 'Filter', 'Espresso'] }], ['Ethiopia Highland', 19, 0, 'coffeebag', 'Coffee', { Size: ['250 g', '1 kg'], Grind: ['Whole bean', 'Filter'] }], ['Colombia Valley', 18, 0, 'coffeebag', 'Coffee', { Size: ['250 g', '1 kg'] }], ['Decaf Night Owl', 17, 0, 'coffeebag', 'Coffee'], ['Ceramic Pour-Over', 34, 0, 'cup', 'Brewing'], ['Ember Mug', 18, 0, 'mug', 'Merch'], ['Coffee Subscription', 30, 0, 'box', 'Subscriptions', { Frequency: ['Every 2 weeks', 'Monthly'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Roasted every Tuesday', heading: 'Small batch. Big flavour.', text: 'Seasonal single origins and our signature house blend.', buttonLabel: 'Shop coffee', buttonLink: 'collection:all', overlay: 40 }),
    S('featured-products', { heading: 'This week’s roasts', columns: 4 }), S('image-text', { heading: 'From farm to cup', text: 'We buy directly from growers and pay well above fair-trade prices.', buttonLabel: 'Our sourcing', buttonLink: 'page:about' }),
    S('banner', { heading: 'Never run out', text: 'Subscribe and save 10% on every bag.', buttonLabel: 'Start a subscription', buttonLink: 'collection:all', style: 'solid' }),
    S('locations', { heading: 'Visit the roastery café', items: [{ name: 'Roastery & Café', address: '48 Mill Road', hours: 'Mon–Fri 7:00–17:00\nSat–Sun 8:00–16:00' }] }), S('newsletter')],
  checkout: 'whatsapp',
});

def({
  id: 'bakery', name: 'Butter & Rye', niche: 'Bakery', category: 'Food & drink', description: 'Friendly neighbourhood bakery with pre-orders.',
  theme: { colors: { background: '#fffaf0', surface: '#fbefd5', text: '#3b2a17', muted: '#8b7355', primary: '#e0a526', primaryText: '#3b2a17', accent: '#c2410c', border: '#f1e1bd' }, fonts: { heading: 'rounded', body: 'verdana' }, headingWeight: 800, radius: 20, buttons: 'pill', headerStyle: 'centered', cardStyle: 'card' },
  art: ['#fbefd5', '#c2410c'], swatches: ['#d9a25b', '#b8763a', '#f3d6a4', '#8b5a2b'], heroArt: 'croissant',
  products: [['Butter Croissant (box of 4)', 12, 0, 'croissant', 'Pastries'], ['Country Sourdough', 8, 0, 'bread', 'Bread'], ['Rye & Seed Loaf', 9, 0, 'bread', 'Bread'], ['Celebration Cake', 45, 0, 'cake', 'Cakes', { Size: ['6 inch', '8 inch', '10 inch'], Flavour: ['Vanilla', 'Chocolate', 'Lemon'] }], ['Cinnamon Buns (box of 6)', 15, 0, 'croissant', 'Pastries'], ['Weekend Brunch Box', 38, 44, 'box', 'Boxes']],
  home: [S('hero', { layout: 'split', eyebrow: 'Baked fresh at 5 am', heading: 'Warm bread, happy mornings', text: 'Pre-order for pick-up or local delivery.', buttonLabel: 'Order now', buttonLink: 'collection:all' }),
    S('featured-products', { heading: 'Today’s bakes', columns: 3 }), S('features', { items: [{ icon: 'clock', title: 'Order by 8 pm', text: 'Ready next morning.' }, { icon: 'leaf', title: 'Real ingredients', text: 'Butter, flour, time.' }, { icon: 'truck', title: 'Local delivery', text: 'Within 5 km.' }] }),
    S('locations', { heading: 'Pick-up & hours', items: [{ name: 'Butter & Rye', address: '7 Baker Street', hours: 'Tue–Sun 7:00–15:00', phone: '+1 555 0142' }] }), S('faq', { items: [{ q: 'Do you have gluten-free options?', a: 'Yes, ask us about our weekly gluten-free bakes.' }, { q: 'How far ahead should I order a cake?', a: 'At least 48 hours.' }] })],
  checkout: 'whatsapp',
});

def({
  id: 'restaurant', name: 'Saffron Table', niche: 'Restaurant menu & ordering', category: 'Food & drink', description: 'Restaurant with menu, takeaway ordering by WhatsApp and hours.',
  theme: { colors: { background: '#fffaf5', surface: '#f7ebe0', text: '#2b1410', muted: '#86625a', primary: '#9b1c1c', primaryText: '#fff7ed', accent: '#e8a317', border: '#ecd9c9' }, fonts: { heading: 'garamond', body: 'helvetica' }, headingWeight: 600, radius: 8, buttons: 'solid', headerStyle: 'centered', cardStyle: 'card', imageRatio: 'landscape' },
  art: ['#f7ebe0', '#e8a317'], swatches: ['#9b1c1c', '#c2410c', '#65a30d', '#ca8a04'], heroArt: 'dish',
  products: [['Saffron Chicken', 18, 0, 'dish', 'Mains', { Spice: ['Mild', 'Medium', 'Hot'] }], ['Lamb Tagine', 22, 0, 'dish', 'Mains'], ['Charred Vegetable Platter', 15, 0, 'dish', 'Mains'], ['Flatbread & Dips', 9, 0, 'bread', 'Starters'], ['Wood-fired Pizza', 16, 0, 'pizza', 'Mains', { Size: ['Regular', 'Large'] }], ['Pistachio Cake', 8, 0, 'cake', 'Desserts'], ['Mint Lemonade', 5, 0, 'cup', 'Drinks']],
  home: [S('hero', { layout: 'image', eyebrow: 'Takeaway & dine-in', heading: 'Slow-cooked, spice-forward', text: 'Order online for pick-up, or book a table.', buttonLabel: 'View menu & order', buttonLink: 'collection:all', button2Label: 'Book a table', button2Link: 'page:contact', overlay: 50 }),
    S('collection-list', { heading: 'Menu', columns: 4 }), S('featured-products', { heading: 'Chef’s favourites', columns: 3, showQuickAdd: true }),
    S('image-text', { heading: 'Our kitchen', text: 'Family recipes, seasonal produce and a wood-fired oven at the heart of it all.' }),
    S('locations', { heading: 'Opening hours', items: [{ name: 'Saffron Table', address: '91 Harbour Road', hours: 'Tue–Thu 17:00–22:00\nFri–Sun 12:00–23:00', phone: '+1 555 0190' }] }),
    S('testimonials', { items: Q(['The tagine is the best in town.', 'Yusuf E.', 'Regular'], ['Ordered on WhatsApp, ready in 20 minutes.', 'Beth A.', 'Takeaway'], ['Warm staff, incredible food.', 'Marco P.', 'Guest']) })],
  checkout: 'whatsapp', announcement: 'Order by WhatsApp — ready for pick-up in 25 minutes',
});

def({
  id: 'plants', name: 'Fernwood', niche: 'Plant shop', category: 'Home & living', description: 'Fresh green plant shop with care guides.',
  theme: { colors: { background: '#f5f8f2', surface: '#e6efe0', text: '#1f2d1f', muted: '#5f735c', primary: '#2f5d3a', primaryText: '#f5f8f2', accent: '#d97941', border: '#d5e2cd' }, fonts: { heading: 'georgia', body: 'trebuchet' }, headingWeight: 700, radius: 16, buttons: 'pill', headerStyle: 'left', cardStyle: 'card', imageRatio: 'portrait' },
  art: ['#e6efe0', '#d97941'], swatches: ['#2f5d3a', '#4d7c4f', '#7aa95c', '#1f4730'], heroArt: 'plant',
  products: [['Monstera Deliciosa', 39, 0, 'plant', 'Large plants', { Size: ['Medium', 'Large'] }], ['Snake Plant', 29, 0, 'plant', 'Easy care'], ['Pothos Golden', 19, 0, 'plant', 'Easy care'], ['Fiddle Leaf Fig', 59, 69, 'plant', 'Large plants'], ['Terracotta Pot', 15, 0, 'vase', 'Pots', { Size: ['12 cm', '17 cm', '24 cm'] }], ['Plant Food', 9, 0, 'bottle', 'Care']],
  home: [S('hero', { layout: 'split', eyebrow: 'Delivered happy & healthy', heading: 'Bring the outside in', text: 'Healthy plants, care guides and a 30-day happiness guarantee.', buttonLabel: 'Shop plants', buttonLink: 'collection:all' }),
    S('collection-list', { heading: 'Find your plant', columns: 4 }), S('featured-products', { heading: 'Bestselling plants', columns: 4 }),
    S('features', { items: [{ icon: 'leaf', title: 'Grown with care', text: 'From local nurseries.' }, { icon: 'truck', title: 'Plant-safe shipping', text: 'Packed to arrive perfect.' }, { icon: 'heart', title: '30-day guarantee', text: 'Free replacement if it struggles.' }] }), S('faq', { items: [{ q: 'Are your plants pet-safe?', a: 'Each product page lists whether the plant is pet-safe.' }, ...FAQ_SHIP.slice(0, 2)] }), S('newsletter', { heading: 'Plant care tips', text: 'Seasonal care tips, monthly.' })],
});

def({
  id: 'books', name: 'Dog-Ear Books', niche: 'Books', category: 'Hobbies & gifts', description: 'Cosy independent bookshop with staff picks.',
  theme: { colors: { background: '#fbf7ef', surface: '#f0e8d8', text: '#26201a', muted: '#7a6e5f', primary: '#1f3a5f', primaryText: '#fbf7ef', accent: '#b23a2a', border: '#e3d8c3' }, fonts: { heading: 'garamond', body: 'georgia' }, headingWeight: 700, radius: 2, buttons: 'solid', headerStyle: 'centered', imageRatio: 'portrait' },
  art: ['#f0e8d8', '#e8c547'], swatches: ['#1f3a5f', '#b23a2a', '#2f5d3a', '#6b4e9b', '#26201a'], heroArt: 'book',
  products: [['The Quiet Orchard (novel)', 18, 0, 'book', 'Fiction', { Format: ['Paperback', 'Hardcover'] }], ['Maps of Small Places', 22, 0, 'book', 'Non-fiction'], ['Midnight at the Lighthouse', 16, 0, 'book', 'Fiction'], ['Cooking with Five Things', 28, 32, 'book', 'Cookbooks'], ['The Curious Fox (kids)', 12, 0, 'book', 'Children'], ['Book Club Box', 45, 0, 'box', 'Gifts', { Plan: ['1 month', '3 months'] }]],
  home: [S('hero', { layout: 'text', eyebrow: 'Independent since 2009', heading: 'Stories worth staying up for', text: 'Hand-picked books, delivered with a handwritten note.', buttonLabel: 'Browse books', buttonLink: 'collection:all' }),
    S('featured-products', { heading: 'Staff picks', columns: 4 }), S('collection-list', { heading: 'Shelves', columns: 4 }), S('rich-text', { heading: 'The book club', text: 'Each month we send a surprise book chosen just for you, plus tea and a bookmark.' }), S('newsletter', { heading: 'New releases, weekly' })],
});

def({
  id: 'pets', name: 'Wag & Whisker', niche: 'Pet supplies', category: 'Hobbies & gifts', description: 'Playful pet store with treats, toys and bundles.',
  theme: { colors: { background: '#ffffff', surface: '#e9f7f5', text: '#123a37', muted: '#5b7e7a', primary: '#0f9d8f', primaryText: '#ffffff', accent: '#ffb020', border: '#d5ece9' }, fonts: { heading: 'rounded', body: 'system' }, headingWeight: 800, radius: 18, buttons: 'pill', headerStyle: 'left', cardStyle: 'card' },
  art: ['#e9f7f5', '#ffb020'], swatches: ['#0f9d8f', '#ff6b6b', '#ffb020', '#5b6cff'], heroArt: 'bone',
  products: [['Chew Bone', 12, 0, 'bone', 'Toys', { Size: ['S', 'M', 'L'] }], ['Ceramic Pet Bowl', 24, 0, 'petbowl', 'Bowls', { Color: ['Teal', 'Coral'] }], ['Fetch Ball 3-Pack', 14, 0, 'ball', 'Toys'], ['Grain-free Treats', 9, 0, 'box', 'Treats'], ['Cosy Pet Bed', 69, 85, 'cushion', 'Beds', { Size: ['S', 'M', 'L'] }], ['Walk Bag', 29, 0, 'bag', 'Walk']],
  home: [S('hero', { layout: 'split', eyebrow: 'For dogs & cats', heading: 'Happy pets, happy homes', text: 'Toys, treats and comfy things your pet will love.', buttonLabel: 'Shop now', buttonLink: 'collection:all' }),
    S('collection-list', { heading: 'Shop by category', columns: 3 }), S('featured-products', { heading: 'Tail-wagging favourites', columns: 4 }),
    S('banner', { heading: 'Build a bundle, save 15%', text: 'Mix any three toys or treats.', buttonLabel: 'Start a bundle', buttonLink: 'collection:all', style: 'solid' }), S('testimonials', { items: Q(['My dog has not put the bone down for a week.', 'Jess M.'], ['Great quality and fast delivery.', 'Ahmed R.'], ['Our cat loves the bed.', 'Lina S.']) }), S('newsletter')],
});

def({
  id: 'toys', name: 'Tiny Giants', niche: 'Kids toys', category: 'Hobbies & gifts', description: 'Bright, rounded toy shop with age filters.',
  theme: { colors: { background: '#fffdf7', surface: '#fff1d6', text: '#1e1b4b', muted: '#6b6894', primary: '#6d28d9', primaryText: '#ffffff', accent: '#f43f5e', border: '#f3e5c4' }, fonts: { heading: 'rounded', body: 'rounded' }, headingWeight: 900, radius: 24, buttons: 'pill', headerStyle: 'centered', cardStyle: 'card' },
  art: ['#fff1d6', '#f43f5e'], swatches: ['#6d28d9', '#10b981', '#f59e0b', '#3b82f6', '#f43f5e'], heroArt: 'rocket',
  products: [['Wooden Block Set', 34, 0, 'blocks', 'Ages 1–3'], ['Cuddle Bear', 26, 0, 'teddy', 'Ages 0+', { Color: ['Honey', 'Cream'] }], ['Rocket Ride-On', 79, 95, 'rocket', 'Ages 3–6'], ['Bouncy Ball Pack', 12, 0, 'ball', 'Ages 3–6'], ['Story Book Bundle', 24, 0, 'book', 'Ages 3–6'], ['Craft Kit Box', 29, 0, 'box', 'Ages 6+']],
  home: [S('hero', { layout: 'gradient', heading: 'Play big, grow bigger', text: 'Safe, sustainable toys for curious kids.', buttonLabel: 'Shop toys', buttonLink: 'collection:all', align: 'center' }),
    S('collection-list', { heading: 'Shop by age', columns: 4 }), S('featured-products', { heading: 'Top toys', columns: 3 }),
    S('features', { items: [{ icon: 'shield', title: 'Safety tested', text: 'Meets EN71 & ASTM standards.' }, { icon: 'leaf', title: 'Sustainable', text: 'FSC wood and recycled plastics.' }, { icon: 'gift', title: 'Free gift wrap', text: 'Add a note at checkout.' }] }), S('faq', { items: FAQ_SHIP })],
});

def({
  id: 'artprints', name: 'Inkwell Prints', niche: 'Art prints', category: 'Home & living', description: 'Minimal gallery-style art print shop.',
  theme: { colors: { background: '#ffffff', surface: '#f6f6f4', text: '#151515', muted: '#7a7a76', primary: '#151515', primaryText: '#ffffff', accent: '#151515', border: '#ebebe8' }, fonts: { heading: 'helvetica', body: 'helvetica' }, headingWeight: 500, radius: 0, buttons: 'sharp', density: 'airy', headerStyle: 'minimal', imageRatio: 'portrait' },
  art: ['#f6f6f4', '#e76f51'], swatches: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'], heroArt: 'print',
  products: [['Dune No. 1', 45, 0, 'print', 'Abstract', { Size: ['A4', 'A3', 'A2'], Frame: ['No frame', 'Black', 'Oak'] }], ['Coastline', 45, 0, 'print', 'Landscape', { Size: ['A4', 'A3', 'A2'] }], ['Sun Study', 55, 0, 'print', 'Abstract', { Size: ['A3', 'A2'] }], ['Still Water', 45, 60, 'print', 'Landscape', { Size: ['A4', 'A3'] }], ['Orbit', 50, 0, 'print', 'Abstract', { Size: ['A3', 'A2'] }], ['Garden Wall', 45, 0, 'print', 'Botanical', { Size: ['A4', 'A3'] }]],
  home: [S('hero', { layout: 'text', heading: 'Art for quiet walls', text: 'Giclée prints on archival cotton paper. Signed and numbered.', buttonLabel: 'View the collection', buttonLink: 'collection:all' }),
    S('featured-products', { heading: '', columns: 3, buttonLabel: '' }), S('rich-text', { heading: 'Printed to last', text: 'Museum-grade pigment inks on 310 gsm cotton rag. Ships flat in recycled packaging.' }), S('newsletter', { heading: 'New editions', text: 'Be first to see new releases.' })],
});

def({
  id: 'digital', name: 'Pixel Pantry', niche: 'Digital downloads', category: 'Digital', description: 'Vivid digital product store for templates and presets.',
  theme: { colors: { background: '#0f0a1e', surface: '#1a1333', text: '#f3efff', muted: '#a69bc9', primary: '#a855f7', primaryText: '#ffffff', accent: '#f472b6', border: '#2b2250' }, fonts: { heading: 'grotesk', body: 'system' }, headingWeight: 800, radius: 16, buttons: 'pill', headerStyle: 'left', cardStyle: 'card', imageRatio: 'landscape' },
  art: ['#1a1333', '#f472b6'], swatches: ['#a855f7', '#22d3ee', '#f472b6', '#facc15'], heroArt: 'file',
  products: [['Notion Life Planner', 24, 0, 'grid', 'Templates'], ['Lightroom Presets Vol. 1', 19, 29, 'camera', 'Presets'], ['Social Media Kit', 35, 0, 'phone', 'Templates', { License: ['Personal', 'Commercial'] }], ['Icon Pack — 600 icons', 29, 0, 'grid', 'Graphics'], ['Budget Spreadsheet', 12, 0, 'file', 'Templates'], ['Creator Bundle', 89, 128, 'box', 'Bundles', null, { featured: true }]],
  home: [S('hero', { layout: 'gradient', eyebrow: 'Instant digital downloads', heading: 'Templates that do the boring part', text: 'Planners, presets and kits used by 20,000+ creators.', buttonLabel: 'Browse downloads', buttonLink: 'collection:all' }),
    S('featured-products', { heading: 'Best sellers', columns: 3 }), S('features', { items: FEAT_DIGITAL }),
    S('testimonials', { items: Q(['Saved me hours every week.', 'Kim N.', 'Creator'], ['Beautiful and easy to customise.', 'Dev P.', 'Designer'], ['Worth every penny.', 'Ana G.', 'Freelancer']) }), S('faq', { items: [{ q: 'How do I get my files?', a: 'After payment, we email your download link within a few hours.' }, { q: 'Can I use them commercially?', a: 'Choose the Commercial licence where offered.' }] })],
  checkout: 'paymentLinks',
});

def({
  id: 'beats', name: 'Low End Theory', niche: 'Music / beats', category: 'Digital', description: 'Dark producer store with beat licences.',
  theme: { colors: { background: '#09090b', surface: '#16161a', text: '#fafafa', muted: '#9a9aa5', primary: '#ff2e88', primaryText: '#ffffff', accent: '#ff2e88', border: '#26262c' }, fonts: { heading: 'condensed', body: 'helvetica' }, headingWeight: 800, headingCase: 'uppercase', radius: 4, buttons: 'solid', density: 'compact', headerStyle: 'left', cardStyle: 'card', imageRatio: 'square' },
  art: ['#16161a', '#ff2e88'], swatches: ['#ff2e88', '#7c3aed', '#06b6d4', '#f59e0b'], heroArt: 'vinyl',
  products: [['Midnight Drive — 92 BPM', 29, 0, 'wave', 'Beats', { License: ['MP3 Lease', 'WAV Lease', 'Unlimited'] }], ['Neon Rain — 140 BPM', 29, 0, 'wave', 'Beats', { License: ['MP3 Lease', 'WAV Lease', 'Unlimited'] }], ['Gold Teeth — 85 BPM', 29, 0, 'vinyl', 'Beats', { License: ['MP3 Lease', 'WAV Lease', 'Unlimited'] }], ['Drum Kit Vol. 3', 39, 49, 'box', 'Kits'], ['Melody Loop Pack', 24, 0, 'wave', 'Kits'], ['Mixing Session (1 song)', 99, 0, 'headphones', 'Services']],
  home: [S('hero', { layout: 'image', eyebrow: 'Beats · Kits · Mixing', heading: 'Sounds that hit different', text: 'Lease a beat in minutes. Exclusive rights on request.', buttonLabel: 'Browse beats', buttonLink: 'collection:all', overlay: 55 }),
    S('featured-products', { heading: 'Latest beats', columns: 3 }), S('pricing', { heading: 'Licences', plans: [{ name: 'MP3 Lease', price: '29', period: '', features: 'MP3 file\n5,000 streams\nCredit required', buttonLabel: 'Browse', buttonLink: 'collection:all' }, { name: 'WAV Lease', price: '49', period: '', features: 'WAV + MP3\n50,000 streams\nMusic video rights', buttonLabel: 'Browse', buttonLink: 'collection:all', highlight: true }, { name: 'Unlimited', price: '149', period: '', features: 'Track stems\nUnlimited streams\nRadio rights', buttonLabel: 'Browse', buttonLink: 'collection:all' }] }),
    S('logos', { heading: 'Placements with', items: [{ name: 'Echo Club' }, { name: 'Northside FM' }, { name: 'Vibe Weekly' }, { name: 'Night Shift' }] }), S('newsletter', { heading: 'Free beat every month' })],
  checkout: 'paymentLinks',
});

def({
  id: 'agency', name: 'Fieldwork Studio', niche: 'Agency services', category: 'Services', description: 'Confident agency site selling productised services.',
  theme: { colors: { background: '#f5f4f0', surface: '#e9e7e0', text: '#111111', muted: '#66645e', primary: '#111111', primaryText: '#f5f4f0', accent: '#ff4d00', border: '#d9d6cc' }, fonts: { heading: 'grotesk', body: 'helvetica' }, headingWeight: 800, radius: 0, buttons: 'sharp', density: 'airy', headerStyle: 'left', imageRatio: 'landscape' },
  art: ['#e9e7e0', '#ff4d00'], swatches: ['#111111', '#ff4d00', '#66645e'], heroArt: 'grid',
  products: [['Brand Identity Sprint', 4500, 0, 'grid', 'Branding'], ['Website Design & Build', 8900, 0, 'laptop', 'Web'], ['Launch Campaign', 3200, 0, 'rocket', 'Marketing'], ['Strategy Workshop', 1200, 0, 'target', 'Strategy'], ['Monthly Design Retainer', 2800, 0, 'users', 'Retainers', { Hours: ['20 h / month', '40 h / month'] }]],
  home: [S('hero', { layout: 'text', eyebrow: 'Independent design studio', heading: 'We make brands people remember', text: 'Fixed-price design sprints for startups and growing companies.', buttonLabel: 'See services', buttonLink: 'collection:all', button2Label: 'Get in touch', button2Link: 'page:contact' }),
    S('logos', { heading: 'Trusted by', items: [{ name: 'Northwind' }, { name: 'Copperline' }, { name: 'Halcyon' }, { name: 'Basecamp Coffee' }, { name: 'Tandem' }] }),
    S('pricing', { heading: 'Productised services', plans: [{ name: 'Identity Sprint', price: '4500', period: '2 weeks', features: 'Logo & wordmark\nColour & type system\nBrand guidelines', buttonLabel: 'Book a sprint', buttonLink: 'collection:all' }, { name: 'Website', price: '8900', period: '4–6 weeks', features: 'Design & build\nCMS setup\nLaunch support', buttonLabel: 'Start a project', buttonLink: 'collection:all', highlight: true }, { name: 'Retainer', price: '2800', period: '/ month', features: 'Dedicated designer\nWeekly check-ins\nCancel any time', buttonLabel: 'Talk to us', buttonLink: 'page:contact' }] }),
    S('image-text', { heading: 'How we work', text: 'Short, focused sprints with clear deliverables. You always know what you get and when.', buttonLabel: 'Our process', buttonLink: 'page:about' }),
    S('testimonials', { items: Q(['They understood us in one workshop.', 'Lena H.', 'CEO, Copperline'], ['On time, on budget, on brand.', 'Sam B.', 'Founder, Tandem'], ['Our conversion rate doubled after launch.', 'Ravi K.', 'CMO, Halcyon']) }), S('faq', { items: [{ q: 'How do we start?', a: 'Choose a service and send the order — we schedule a kickoff call within two days.' }, { q: 'Do you work internationally?', a: 'Yes, we work remotely with clients worldwide.' }] })],
  checkout: 'email',
});

def({
  id: 'cosmetics', name: 'Chroma Lab', niche: 'Cosmetics', category: 'Beauty', description: 'Bold colour cosmetics with shade pickers.',
  theme: { colors: { background: '#fff5f7', surface: '#ffe4ea', text: '#2a0a14', muted: '#8c5566', primary: '#d6195f', primaryText: '#ffffff', accent: '#d6195f', border: '#f8cfd9' }, fonts: { heading: 'impact', body: 'helvetica' }, headingWeight: 800, headingCase: 'uppercase', radius: 12, buttons: 'pill', headerStyle: 'centered', cardStyle: 'card' },
  art: ['#ffe4ea', '#2a0a14'], swatches: ['#d6195f', '#9f1239', '#f472b6', '#be123c', '#fb7185'], heroArt: 'lipstick',
  products: [['Velvet Matte Lipstick', 22, 0, 'lipstick', 'Lips', { Shade: ['Ruby', 'Rose', 'Nude', 'Berry'] }], ['Glow Highlighter', 26, 0, 'palette', 'Face'], ['Eyeshadow Palette — Sunset', 38, 48, 'palette', 'Eyes'], ['Lip Gloss Trio', 24, 0, 'lipstick', 'Lips'], ['Signature Perfume', 68, 0, 'perfume', 'Fragrance', { Size: ['30 ml', '50 ml'] }], ['Brush Set', 34, 0, 'box', 'Tools']],
  home: [S('hero', { layout: 'carousel', heading: 'Colour loud', slides: [{ heading: 'Velvet Matte', text: '12-hour colour in 4 bold shades.', buttonLabel: 'Shop lips', buttonLink: 'collection:all' }, { heading: 'Sunset palette', text: '12 shades from peach to plum.', buttonLabel: 'Shop eyes', buttonLink: 'collection:all' }], overlay: 20 }),
    S('product-carousel', { heading: 'Trending shades' }), S('countdown', { heading: 'Flash sale', text: '20% off palettes for 48 hours.', buttonLabel: 'Shop the sale', buttonLink: 'collection:all' }),
    S('featured-products', { heading: 'Cult favourites', columns: 4 }), S('insta-grid', { heading: '#ChromaLab', handle: '@chromalab' }), S('newsletter')],
});

def({
  id: 'outdoor', name: 'Ridgeline Outfitters', niche: 'Outdoor gear', category: 'Fitness & sport', description: 'Rugged outdoor gear shop with field-tested story.',
  theme: { colors: { background: '#f4f2ec', surface: '#e5e2d6', text: '#1d2a1f', muted: '#66705f', primary: '#2f4a33', primaryText: '#f4f2ec', accent: '#e07a1f', border: '#d3cfbf' }, fonts: { heading: 'condensed', body: 'verdana' }, headingWeight: 800, headingCase: 'uppercase', radius: 4, buttons: 'solid', headerStyle: 'left', cardStyle: 'bordered' },
  art: ['#e5e2d6', '#e07a1f'], swatches: ['#2f4a33', '#e07a1f', '#4b5563', '#7c5e3c'], heroArt: 'tent',
  products: [['Summit 2P Tent', 349, 399, 'tent', 'Camp', null, { featured: true }], ['Trailhead 30L Pack', 129, 0, 'backpack', 'Packs', { Color: ['Forest', 'Ember'] }], ['Alpine Hiking Boot', 189, 0, 'boot', 'Footwear', { Size: ['40', '41', '42', '43', '44', '45'] }], ['Storm Shell Jacket', 229, 0, 'jacket', 'Apparel', { Size: SIZES }], ['Trail Bottle', 24, 0, 'bottle', 'Camp'], ['Wool Beanie', 29, 0, 'cap', 'Apparel']],
  home: [S('hero', { layout: 'image', eyebrow: 'Field-tested gear', heading: 'Go further. Stay out longer.', text: 'Tents, packs and layers built for real weather.', buttonLabel: 'Shop gear', buttonLink: 'collection:all', overlay: 45 }),
    S('collection-list', { heading: 'Gear up', columns: 4 }), S('featured-products', { heading: 'Trail favourites', columns: 3 }),
    S('features', { items: [{ icon: 'shield', title: 'Lifetime repairs', text: 'We fix what breaks.' }, { icon: 'leaf', title: '1% for the planet', text: 'Supporting public lands.' }, { icon: 'truck', title: 'Free shipping', text: 'On orders over $99.' }] }),
    S('image-text', { heading: 'Tested on the ridge', text: 'Every product spends a season with our guides before it reaches the shop.', buttonLabel: 'Our story', buttonLink: 'page:about', imageSide: 'right' }), S('newsletter', { heading: 'Trail notes', text: 'Routes, gear tips and early access.' })],
});

def({
  id: 'candles', name: 'Wick & Hollow', niche: 'Candles & gifts', category: 'Hobbies & gifts', description: 'Moody candle and gift shop with scent options.',
  theme: { colors: { background: '#1d1a17', surface: '#29241f', text: '#f2e9dc', muted: '#b3a48f', primary: '#e8c39e', primaryText: '#1d1a17', accent: '#e8c39e', border: '#3a332c' }, fonts: { heading: 'didone', body: 'georgia' }, headingWeight: 400, radius: 10, buttons: 'outline', density: 'airy', headerStyle: 'centered', imageRatio: 'portrait' },
  art: ['#29241f', '#e8c39e'], swatches: ['#e8c39e', '#8d6e63', '#556b5d', '#c6a2a2'], heroArt: 'candle',
  products: [['Cedar & Smoke Candle', 34, 0, 'candle', 'Candles', { Size: ['200 g', '400 g'] }], ['Fig Leaf Candle', 34, 0, 'candle', 'Candles', { Size: ['200 g', '400 g'] }], ['Amber Reed Diffuser', 42, 0, 'perfume', 'Diffusers'], ['Matchstick Jar', 12, 0, 'jar', 'Accessories'], ['Gift Box Trio', 89, 102, 'box', 'Gifts'], ['Stoneware Candle Dish', 26, 0, 'dish', 'Accessories']],
  home: [S('hero', { layout: 'image', heading: 'Slow evenings, bottled', text: 'Hand-poured soy candles in small batches.', buttonLabel: 'Shop scents', buttonLink: 'collection:all', align: 'center', overlay: 45 }),
    S('featured-products', { heading: 'Signature scents', columns: 3 }), S('rich-text', { heading: 'Poured by hand', text: 'Natural soy wax, cotton wicks and fine fragrance oils. 50+ hour burn time.' }),
    S('banner', { heading: 'The gift box', text: 'Three bestsellers, wrapped and ready to give.', buttonLabel: 'Shop gifts', buttonLink: 'collection:all', style: 'outline' }), S('testimonials', { items: Q(['The cedar candle fills the whole room.', 'Marie L.'], ['Gorgeous packaging, perfect gift.', 'Owen F.'], ['My third order already.', 'Zoe B.']) })],
});

export const STORE_TEMPLATES = T.map(t => ({ id: t.id, name: t.name, niche: t.niche, category: t.category, description: t.description, swatch: [t.theme.colors.background, t.theme.colors.primary, t.theme.colors.accent] }));
export const TEMPLATE_CATEGORIES = [...new Set(T.map(t => t.category))];

const DESC = {
  default: t => `${t} is designed to be used and loved every day. Thoughtful details, quality materials and a finish that lasts.\n\nShips in recyclable packaging.`,
  'Education': t => `${t} — step-by-step video lessons, downloadable resources and practical assignments. Learn at your own pace with lifetime access.`,
  'Services': t => `${t}: a clearly scoped engagement with defined deliverables and timeline. After ordering we get in touch to schedule the kickoff.`,
  'Digital': t => `${t} — an instant digital download. You receive the files by email after your order is confirmed.`,
  'Food & drink': t => `${t}, freshly prepared with quality ingredients. Please mention any allergies in the order notes.`,
};

/** Build a complete store from a template id (unknown/omitted id → 'general'). */
export function createStore(templateId = 'general') {
  const t = T.find(x => x.id === templateId) || T.find(x => x.id === 'general');
  const [abg, aac] = t.art, sw = t.swatches;
  const products = t.products.map(([title, price, compareAt, kind, category, options, extra], i) => {
    const fg = sw[i % sw.length], fg2 = sw[(i + 1) % sw.length];
    const opts = options ? Object.entries(options).map(([name, values]) => ({ name, values })) : [];
    const stockFor = k => (i * 7 + k * 3) % 11 === 5 ? 0 : 5 + ((i * 13 + k * 5) % 20);
    const p = { id: uid('p'), title, slug: slugify(title), price, compareAt: compareAt || null, category, description: (DESC[t.category] || DESC.default)(title),
      images: [gen(kind, abg, fg, aac, i + 1), gen(kind, abg, fg2, aac, i + 11)], options: opts, tags: [slugify(category)], featured: i < 4, status: 'active', ...(extra || {}) };
    let combos = [[]]; for (const o of opts) combos = combos.flatMap(c => o.values.map(v => [...c, v]));
    p.variants = combos.map((c, k) => ({ id: uid('v'), options: c, price: null, sku: [slugify(title).toUpperCase().slice(0, 18), ...c.map(v => slugify(v).toUpperCase())].join('-'), stock: t.category === 'Digital' || t.category === 'Education' || t.category === 'Services' ? null : stockFor(k) }));
    // Price steps for size-like options (bigger = pricier)
    if (opts[0] && /size|weight|length|license|metal|plan|hours|format/i.test(opts[0].name) && opts[0].values.length > 1 && !/^(XS|S|M|L|XL|\d\d)$/.test(opts[0].values[0])) {
      p.variants.forEach(v => { const idx = opts[0].values.indexOf(v.options[0]); if (idx > 0) v.price = Math.round(price * (1 + idx * (/license/i.test(opts[0].name) ? 0.7 : 0.35))); });
    }
    return p;
  });
  const cats = [...new Set(products.map(p => p.category))];
  const collections = cats.map(c => ({ id: uid('c'), title: c, slug: slugify(c), description: '', image: null, rule: { type: 'category', value: c, productIds: [] } }));
  const [hbg, hfg, hac] = [abg, sw[0], aac];
  const heroImg = gen(t.heroArt, hbg, hfg, hac, 3, true), sideImg = gen(t.heroArt, abg, sw[1 % sw.length], aac, 5);
  const home = t.home.map(s => {
    const st = { ...s.settings };
    if (s.type === 'hero') {
      if (!st.image) st.image = st.layout === 'split' ? sideImg : heroImg;
      if (st.slides) st.slides = st.slides.map((sl, i) => ({ image: gen(t.heroArt, hbg, sw[i % sw.length], hac, 3 + i, true), ...sl }));
    }
    if (s.type === 'image-text' && !st.image) st.image = gen(t.heroArt, abg, sw[2 % sw.length], aac, 9, true);
    if (s.type === 'banner' && st.style === 'image' && !st.image) st.image = heroImg;
    if (s.type === 'gallery' && !(st.images || []).length) st.images = products.slice(0, 6).map((p, i) => ({ image: p.images[i % 2], caption: '' }));
    if (s.type === 'countdown' && !st.endsAt) st.endsAt = new Date(Date.now() + 5 * 864e5 + 7 * 36e5).toISOString().slice(0, 16);
    return { type: s.type, settings: st };
  });
  // in-page anchors used by hero buttons point to a section of that page (rewritten to the section id below)
  const homeSections = home.map(s => ({ id: uid('s'), ...s }));
  const anchor = { '#plans': 'pricing', '#curriculum': 'curriculum', '#newsletter': 'newsletter' };
  for (const s of homeSections) for (const k of ['buttonLink', 'button2Link']) {
    const want = anchor[s.settings[k]];
    if (want) { const target = homeSections.find(x => x.type === want); s.settings[k] = target ? '#' + target.id : 'collection:all'; }
  }
  const [cur, loc] = t.currency || ['USD', 'en-US'];
  const mode = t.checkout || 'whatsapp';
  const email = 'hello@' + slugify(t.name).replace(/-/g, '') + '.example';
  const store = {
    kind: 'store', templateId: t.id, name: t.name, logo: { text: t.name, image: null, height: 32 }, theme: t.theme, currency: { code: cur, locale: loc },
    announcement: { enabled: !!t.announcement, text: t.announcement || 'Free shipping on your first order', link: 'collection:all' },
    layout: { header: { type: 'header', settings: { sticky: true } }, footer: { type: 'footer', settings: { text: t.description } } },
    pages: {
      home: homeSections,
      collection: [S('collection-main', { columns: products.length > 6 ? 4 : 3 })],
      product: [S('product-main', mode === 'paymentLinks' ? { buttonLabel: 'Add to cart' } : {}), S('related-products')],
      about: [S('page-title', { heading: `About ${t.name}`, text: '' }), S('image-text', { image: sideImg, heading: 'Our story', text: `${t.name} started with a simple idea: ${t.description.charAt(0).toLowerCase() + t.description.slice(1)}\n\nWe are a small team who care about every detail, from the first sketch to the moment your order arrives.` }), S('features', { items: FEAT_SHOP })],
      contact: [S('page-title', { heading: 'Contact us', text: 'Questions about an order or a product? We are happy to help.' }), S('contact-form')],
      cart: [S('cart-main')], checkout: [S('checkout-main')],
    },
    products, collections,
    navigation: {
      main: [{ label: 'Shop', target: 'collection:all' }, ...collections.slice(0, 2).map(c => ({ label: c.title, target: 'collection:' + c.id })), { label: 'About', target: 'page:about' }, { label: 'Contact', target: 'page:contact' }],
      footer: [{ label: 'All products', target: 'collection:all' }, { label: 'About', target: 'page:about' }, { label: 'Contact', target: 'page:contact' }, { label: 'Cart', target: 'cart' }],
    },
    social: { instagram: '', facebook: '', tiktok: '', youtube: '', x: '', pinterest: '' },
    contact: { email, phone: '+1 555 0100', address: '', hours: '' },
    checkout: { mode, phone: '15550100', email, paymentLinks: {}, shippingNote: t.category === 'Digital' || t.category === 'Education' || t.category === 'Services' ? '' : 'Shipping is calculated and confirmed with you after ordering.', note: '' },
    seo: { title: `${t.name} — ${t.niche}`, description: t.description },
  };
  return normalizeStore(store);
}
