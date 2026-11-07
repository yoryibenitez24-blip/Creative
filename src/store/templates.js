// Store templates: 27 original, complete multi-page stores across niches. Product names and prices are generic
// samples. Images are curated Unsplash photos from src/store/photos.js ('unsplash:<id>' refs, hot-linked);
// every product and the store also carry procedural art (src/store/art.js) used as the offline fallback.
//
//   STORE_TEMPLATES: [{ id, name, niche, category, description, swatch: [bg, fg, accent], photo: 'unsplash:<id>' }]
//   createStore(templateId?) → a normalised store document ready for the builder
//   TEMPLATE_CATEGORIES: category filter values for the gallery

import { gen } from './art.js';
import { PHOTOS } from './photos.js';
import { normalizeStore, slugify, uid } from './model.js';

const S = (type, settings = {}) => ({ type, settings });
const SIZES = ['XS', 'S', 'M', 'L', 'XL'], SML = ['S', 'M', 'L'];

// Copy blocks. Photo tokens inside settings are resolved per template: '@h0' hero photo, '@p2' product photo, '@u1' people photo.
const Q = (...xs) => xs.map(([quote, name, role, avatar]) => ({ quote, name, role: role || 'Verified buyer', avatar: avatar || null }));
const FAQ_SHIP = [{ q: 'How long does delivery take?', a: 'Orders are packed within 1–2 business days. Delivery usually takes 3–5 business days.' }, { q: 'What is your return policy?', a: 'Unused items can be returned within 30 days. Contact us and we will guide you through it.' }, { q: 'How do I pay?', a: 'Place your order through the checkout and we confirm payment details with you directly.' }];
const STRIP = [{ icon: 'truck', title: 'Free shipping', text: 'On orders over 75' }, { icon: 'refresh', title: 'Easy returns', text: '30 days to change your mind' }, { icon: 'shield', title: 'Secure ordering', text: 'Your details stay private' }, { icon: 'chat', title: 'Real support', text: 'Message us any time' }];
const FEAT_DIGITAL = [{ icon: 'bolt', title: 'Instant access', text: 'Start the moment your order is confirmed.' }, { icon: 'refresh', title: 'Lifetime updates', text: 'Every future update included.' }, { icon: 'users', title: 'Community', text: 'Learn alongside other members.' }];

/*
 Template definition:
   theme (partial), art: [background, accent] for fallback art, swatches: fallback art colours, heroArt: art kind,
   niche: photos.js group, products: [title, price, compareAt|0, artKind, category, options?, extra?] where
   extra.ph = [token, token] picks the product photos (default: '@p<i>', '@p<i+1>'),
   home: section list; optional about/contact copy, checkout, currency, announcement (+ style), payments.
*/
const T = [];
const def = d => T.push(d);

def({
  id: 'gym', name: 'Ironclad', niche: 'Gym / fitness', category: 'Fitness & sport', photos: 'fitness', description: 'Bold, dark gym brand with memberships, gear and class timetable.',
  theme: { colors: { background: '#0b0b0c', surface: '#17171a', text: '#f5f5f4', muted: '#a1a1aa', primary: '#ff3b2f', primaryText: '#ffffff', accent: '#ff3b2f', border: '#2a2a2e' }, fonts: { heading: 'condensed', body: 'inter' }, headingWeight: 800, headingCase: 'uppercase', radius: 10, buttons: 'pill', density: 'comfortable', headerStyle: 'split', cardStyle: 'card', imageRatio: 'portrait', headingScale: 'huge', tracking: 'normal', shadow: 'strong' },
  art: ['#1c1c22', '#ff3b2f'], swatches: ['#3f3f46', '#e4e4e7', '#ff3b2f', '#71717a'], heroArt: 'dumbbell',
  products: [['Hex Dumbbell Pair', 89, 0, 'dumbbell', 'Equipment', { Weight: ['5 kg', '10 kg', '15 kg'] }, { ph: ['@p0', '@p3'] }], ['Olympic Barbell', 249, 289, 'dumbbell', 'Equipment', { Weight: ['15 kg', '20 kg'] }, { ph: ['@p1', '@h1'] }], ['Pro Exercise Mat', 39, 0, 'band', 'Equipment', { Color: ['Black', 'Red'] }, { ph: ['@p2', '@h0'] }], ['Dumbbell Rack', 189, 0, 'dumbbell', 'Equipment', null, { ph: ['@h0', '@p3'] }], ['Day Pass', 15, 0, 'ticket', 'Passes', null, { ph: ['@h0', '@p0'] }], ['Personal Training (5 sessions)', 299, 349, 'target', 'Coaching', null, { ph: ['@h1', '@p1'] }]],
  home: [S('hero', { layout: 'carousel', eyebrow: 'Open 24/7 · Downtown', heading: 'Stronger every single day', slides: [{ image: '@h1', heading: 'Stronger every single day', text: 'Coached classes, open gym and gear built for hard training.', buttonLabel: 'See memberships', buttonLink: '#plans' }, { image: '@h0', heading: 'Lift without limits', text: 'Full rack floor, platforms and competition plates.', buttonLabel: 'Shop gear', buttonLink: 'collection:all' }], height: 'full', overlay: 45, autoplay: 6 }),
    S('marquee', { text: 'Strength | Conditioning | Mobility | Open 24/7 | Coached classes', style: 'outline', speed: 32 }),
    S('bento', { eyebrow: 'The club', heading: 'Everything you need to train', items: [{ image: '@h0', title: 'Full rack floor', text: '12 racks, 4 platforms, plates to 50 kg.', link: 'page:about' }, { image: '@p2', title: '40+ classes a week', text: 'HIIT, strength and mobility.', link: '' }, { image: null, title: '24/7 access', text: 'Train on your schedule with your member app.', link: '' }, { image: '@p1', title: 'Certified coaches', text: 'Programs that get results.', link: 'page:contact' }] }),
    S('pricing', { eyebrow: 'Memberships', heading: 'Pick your plan', plans: [{ name: 'Open Gym', price: '39', period: '/ month', features: '24/7 gym floor\nLocker room\nApp workouts', buttonLabel: 'Join now', buttonLink: 'page:contact' }, { name: 'Unlimited', price: '69', period: '/ month', features: 'Everything in Open Gym\nUnlimited classes\nMonthly body scan', buttonLabel: 'Join now', buttonLink: 'page:contact', highlight: true }, { name: 'Personal', price: '149', period: '/ month', features: 'Everything in Unlimited\n4 personal sessions\nNutrition plan', buttonLabel: 'Book a call', buttonLink: 'page:contact' }] }),
    S('featured-products', { eyebrow: 'Shop', heading: 'Train-ready gear', columns: 3 }),
    S('countdown', { eyebrow: 'New-member week', heading: 'First month half price', text: 'Sign up before the timer runs out.', buttonLabel: 'Claim offer', buttonLink: 'page:contact', image: '@p0' }),
    S('testimonials', { items: Q(['Best coaching I have had in ten years of lifting.', 'Marcus T.', 'Member since 2021'], ['The classes are brutal in the best way.', 'Dana W.', 'Unlimited member'], ['Clean, friendly and always open.', 'Kofi A.', 'Open Gym member']) }),
    S('locations', { heading: 'Find us', image: '@h1', items: [{ name: 'Ironclad Downtown', address: '200 Foundry Lane', hours: 'Open 24/7\nStaffed 6:00–22:00', phone: '+1 555 0100' }] })],
  announcement: 'New-member week: first month half price | Open 24/7 | Free intro session', annStyle: 'marquee', payments: 'Card, Cash',
});

def({
  id: 'course', name: 'Lumen Academy', niche: 'Online course', category: 'Education', photos: 'learning', description: 'Bright course platform with curriculum, plans and FAQ.',
  theme: { colors: { background: '#fbfaff', surface: '#efedff', text: '#14123a', muted: '#5e5b80', primary: '#4f46e5', primaryText: '#ffffff', accent: '#4f46e5', border: '#e2e0f5' }, fonts: { heading: 'inter', body: 'inter' }, headingWeight: 800, radius: 22, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', imageRatio: 'landscape', headingScale: 'large', tracking: 'tight' },
  art: ['#eceaff', '#f59e0b'], swatches: ['#4f46e5', '#0ea5e9', '#14b8a6', '#ec4899'], heroArt: 'play',
  products: [['Design Foundations', 129, 199, 'play', 'Courses', null, { rating: 4.9, reviews: 412, tags: ['new'] }], ['Photography Masterclass', 149, 0, 'camera', 'Courses'], ['Creative Writing Lab', 99, 0, 'book', 'Courses'], ['Course Bundle — All Access', 349, 477, 'grid', 'Bundles', null, { featured: true }], ['1:1 Mentoring Session', 89, 0, 'chat', 'Mentoring', { Length: ['30 min', '60 min'] }], ['Study Workbook (PDF)', 19, 0, 'file', 'Resources']],
  home: [S('hero', { layout: 'split', eyebrow: 'Self-paced online courses', heading: 'Learn skills you will actually use', text: 'Short video lessons, real projects and feedback from working professionals.', buttonLabel: 'Browse courses', buttonLink: 'collection:all', button2Label: 'See the curriculum', button2Link: '#curriculum', image: '@h0' }),
    S('logos', { heading: 'Students from', items: [{ name: 'Brightside' }, { name: 'Northwave' }, { name: 'Kinetic' }, { name: 'Papertrail' }, { name: 'Outline' }] }),
    S('featured-products', { eyebrow: 'Popular now', heading: 'Start learning today', columns: 3 }),
    S('curriculum', { heading: 'Inside Design Foundations', text: '6 modules · 42 lessons · 9 hours of video', modules: [{ title: 'Seeing like a designer', duration: '1 h 10 min', lessons: 'Welcome & setup\nVisual hierarchy\nThe grid\nAssignment: poster' }, { title: 'Type that works', duration: '1 h 35 min', lessons: 'Choosing typefaces\nPairing fonts\nSpacing & rhythm' }, { title: 'Colour with confidence', duration: '1 h 20 min', lessons: 'Colour models\nBuilding a palette\nContrast & accessibility' }, { title: 'Final project', duration: '2 h', lessons: 'Brief\nCritique\nPortfolio presentation' }] }),
    S('bento', { heading: 'Why learners stay', items: [{ image: '@h1', title: 'Learn by doing', text: 'Every module ends with a real project.', link: 'collection:all' }, { image: null, title: 'Lifetime access', text: 'Watch at your own pace, forever.', link: '' }, { image: '@p0', title: 'Expert feedback', text: 'Reviews from working designers.', link: '' }] }),
    S('pricing', { heading: 'Simple pricing', plans: [{ name: 'Single course', price: '129', period: 'one-time', features: 'One course of your choice\nLifetime access\nCertificate', buttonLabel: 'Choose a course', buttonLink: 'collection:all' }, { name: 'All Access', price: '349', period: 'one-time', features: 'Every course, forever\nNew courses included\nPrivate community', buttonLabel: 'Get All Access', buttonLink: 'collection:all', highlight: true }] }),
    S('testimonials', { items: Q(['I landed my first freelance client after module four.', 'Aisha B.', 'Student'], ['Clear, practical and genuinely fun.', 'Tom H.', 'Student'], ['The feedback on my projects was worth it alone.', 'Mei L.', 'Student']) }),
    S('faq', { items: [{ q: 'How long do I have access?', a: 'Forever. Watch at your own pace and revisit any time.' }, { q: 'Do I need experience?', a: 'No. Every course starts from the basics.' }, { q: 'How do I receive the course after ordering?', a: 'We email your login within one business day after confirming your order.' }] })],
  checkout: 'email',
});

def({
  id: 'trading', name: 'Candle & Chart', niche: 'Trading course', category: 'Education', photos: 'trading', description: 'Dark, data-driven trading education with risk-first messaging.',
  theme: { colors: { background: '#070b14', surface: '#0f1729', text: '#e6edf7', muted: '#8b9ab5', primary: '#22c55e', primaryText: '#04130a', accent: '#22c55e', border: '#1c2740' }, fonts: { heading: 'inter', body: 'inter' }, headingWeight: 700, radius: 16, buttons: 'pill', headerStyle: 'split', cardStyle: 'bordered', imageRatio: 'landscape', headingScale: 'large', tracking: 'tight', shadow: 'strong' },
  art: ['#0f1a30', '#22c55e'], swatches: ['#1e293b', '#334155', '#0f766e', '#1d4ed8'], heroArt: 'chart',
  products: [['Price Action Fundamentals', 197, 0, 'chart', 'Courses', null, { rating: 4.8, reviews: 236 }], ['Risk Management Bootcamp', 147, 0, 'target', 'Courses'], ['Swing Trading System', 297, 397, 'chart', 'Courses', null, { featured: true, ph: ['@h0', '@p1'] }], ['Trading Journal Template', 29, 0, 'file', 'Tools'], ['Weekly Market Review (monthly)', 39, 0, 'play', 'Memberships', null, { ph: ['@h1', '@p0'] }]],
  home: [S('hero', { layout: 'gradient', eyebrow: 'Education, not signals', heading: 'Trade with a plan, not a hunch', text: 'Structured lessons on price action, risk and psychology — taught by traders who journal every trade.', buttonLabel: 'Explore courses', buttonLink: 'collection:all', button2Label: 'Curriculum', button2Link: '#curriculum', image: '@h0', background: '#0a1224', textColor: '#e6edf7' }),
    S('features', { style: 'strip', columns: 3, items: [{ icon: 'shield', title: 'Risk first', text: 'Position sizing before entries' }, { icon: 'play', title: '60+ lessons', text: 'Short, focused video modules' }, { icon: 'users', title: 'Live reviews', text: 'Weekly chart breakdowns' }] }),
    S('featured-products', { eyebrow: 'Programs', heading: 'Choose your path', columns: 3 }),
    S('curriculum', { heading: 'Swing Trading System', text: 'Three modules from structure to psychology.', modules: [{ title: 'Market structure', duration: '1 h 30 min', lessons: 'Trends & ranges\nSupport and resistance\nTimeframes' }, { title: 'Entries & exits', duration: '2 h', lessons: 'Setups\nStops\nTaking profit' }, { title: 'Risk & psychology', duration: '1 h 45 min', lessons: 'Position sizing\nDrawdowns\nJournaling' }] }),
    S('countdown', { eyebrow: 'Next cohort', heading: 'Enrolment closes in', text: 'Live sessions start with the next cohort.', buttonLabel: 'Enrol now', buttonLink: 'collection:all', image: '@h1' }),
    S('testimonials', { items: Q(['Finally a course that talks about risk before profits.', 'Rahul S.', 'Student'], ['The journal template changed how I review trades.', 'Elena V.', 'Student'], ['Clear, honest and no hype.', 'Chris D.', 'Student']) }),
    S('faq', { items: [{ q: 'Do you guarantee profits?', a: 'No. Trading involves substantial risk of loss. Our courses are educational and are not financial advice.' }, { q: 'Which markets are covered?', a: 'The concepts apply to stocks, forex and crypto charts.' }, { q: 'Is there a refund?', a: 'Yes — 14 days if you have watched less than 20% of the course.' }] }),
    S('rich-text', { heading: 'Risk disclaimer', text: 'Trading financial instruments carries a high level of risk and may not be suitable for all investors. Past performance is not indicative of future results. Nothing on this site is investment advice.', align: 'left', size: 'regular' })],
  checkout: 'paymentLinks', announcement: 'Next live cohort starts soon — limited seats', payments: 'Card, Wallets',
});

def({
  id: 'coaching', name: 'North Star Coaching', niche: 'Coaching', category: 'Services', photos: 'business', description: 'Warm, editorial coaching site with packages and testimonials.',
  theme: { colors: { background: '#f7f1ea', surface: '#efe4d6', text: '#2b2118', muted: '#7a6a5a', primary: '#2b2118', primaryText: '#f7f1ea', accent: '#c26a3d', border: '#e2d5c4' }, fonts: { heading: 'iowan', body: 'avenir' }, headingWeight: 500, radius: 20, buttons: 'pill', density: 'airy', headerStyle: 'split', imageRatio: 'portrait', headingScale: 'large', tracking: 'tight' },
  art: ['#efe5d8', '#c26a3d'], swatches: ['#2b2118', '#7a6a5a', '#c26a3d'], heroArt: 'target',
  products: [['Clarity Session (90 min)', 180, 0, 'target', 'Sessions'], ['3-Month Coaching Package', 1200, 1440, 'award', 'Packages', null, { featured: true }], ['Leadership Intensive (1 day)', 950, 0, 'users', 'Packages'], ['Goal-Setting Workbook', 24, 0, 'book', 'Resources']],
  home: [S('hero', { layout: 'split', eyebrow: 'Career & life coaching', heading: 'Find your direction. Then move.', text: 'One-to-one coaching for people ready to make their next chapter intentional.', buttonLabel: 'Book a clarity session', buttonLink: 'collection:all', button2Label: 'How it works', button2Link: 'page:about', image: '@h0' }),
    S('rich-text', { text: '“Clarity is not found, it is built — one honest conversation at a time.”', align: 'center', size: 'large' }),
    S('image-text', { eyebrow: 'Meet your coach', heading: 'Twelve years of helping people move', text: 'I have helped founders, managers and career-changers find clarity and act on it. My approach is practical, warm and honest.', buttonLabel: 'My story', buttonLink: 'page:about', layout: 'overlap', image: '@h1' }),
    S('pricing', { heading: 'Ways to work together', plans: [{ name: 'Clarity Session', price: '180', period: 'single', features: '90-minute deep dive\nWritten action plan\nOne follow-up email', buttonLabel: 'Book', buttonLink: 'collection:all' }, { name: '3-Month Package', price: '1200', period: 'total', features: '6 sessions\nMessaging support\nWorkbook included', buttonLabel: 'Start', buttonLink: 'collection:all', highlight: true }, { name: 'Leadership Intensive', price: '950', period: 'day', features: 'Full-day workshop\nTeam assessment\n30-day check-in', buttonLabel: 'Enquire', buttonLink: 'page:contact' }] }),
    S('testimonials', { items: Q(['I left my first session with a plan I actually followed.', 'Hannah P.', 'Product manager'], ['Calm, sharp and kind. Exactly what I needed.', 'Jorge M.', 'Founder'], ['Three months that changed my career.', 'Olivia K.', 'Designer']) }),
    S('faq', { items: [{ q: 'Where do sessions happen?', a: 'Online by video call, or in person in the studio.' }, { q: 'How do I book?', a: 'Choose a package and send the order — I reply within a day to schedule.' }] }),
    S('newsletter', { heading: 'A monthly letter', text: 'One thoughtful note a month on focus, work and change.', image: '@p1' })],
  checkout: 'email',
});

def({
  id: 'merch', name: 'Static Noise', niche: 'Merch / streetwear', category: 'Fashion', photos: 'fashion', description: 'Loud streetwear drop store with marquee, countdown and lookbook.',
  theme: { colors: { background: '#f2f2ee', surface: '#e4e4dd', text: '#0a0a0a', muted: '#5a5a55', primary: '#0a0a0a', primaryText: '#d9ff3f', accent: '#c6f000', border: '#d2d2c8' }, fonts: { heading: 'condensed', body: 'inter' }, headingWeight: 900, headingCase: 'uppercase', radius: 4, buttons: 'sharp', density: 'compact', headerStyle: 'split', cardStyle: 'plain', imageRatio: 'portrait', headingScale: 'huge', tracking: 'normal', shadow: 'none' },
  art: ['#e4e4dd', '#c6f000'], swatches: ['#0a0a0a', '#f2f2ee', '#6b7280', '#c6f000'], heroArt: 'hoodie',
  products: [['Static Heavy Tee', 35, 0, 'tshirt', 'Tees', { Size: SIZES, Color: ['White', 'Black', 'Bone'] }, { ph: ['@p0', '@u0'], tags: ['new'], rating: 4.8, reviews: 132 }], ['Noise Hoodie', 85, 0, 'hoodie', 'Hoodies', { Size: SIZES, Color: ['Grey', 'Black'] }, { ph: ['@p1', '@u1'], rating: 4.9, reviews: 88 }], ['Signal Crewneck', 70, 0, 'hoodie', 'Hoodies', { Size: SIZES }, { ph: ['@p4', '@u2'] }], ['Distortion Denim Jacket', 140, 175, 'jacket', 'Outerwear', { Size: SML, Color: ['Denim'] }, { ph: ['@p5', '@u4'] }], ['Overshirt — Sage', 90, 0, 'jacket', 'Outerwear', { Size: SML }, { ph: ['@p3', '@h2'] }], ['Knit Poncho', 110, 0, 'jacket', 'Outerwear', null, { ph: ['@p2', '@u3'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Drop 07 — out now', heading: 'Turn it up', text: 'Limited run. No restocks.', buttonLabel: 'Shop the drop', buttonLink: 'collection:all', align: 'left', overlay: 30, image: '@h3', height: 'full' }),
    S('marquee', { text: 'Drop 07 | Limited run | No restocks | Worldwide shipping', style: 'accent', speed: 26 }),
    S('product-carousel', { eyebrow: 'Fresh off the press', heading: 'New this drop' }),
    S('collection-list', { heading: 'Shop the range', columns: 3, style: 'tall' }),
    S('image-text', { eyebrow: 'Lookbook', heading: 'Made for the street, built to last', text: '400 gsm cotton, heavy rib, boxy fits. Printed in small batches by people who care.', buttonLabel: 'View the drop', buttonLink: 'collection:all', layout: 'full', image: '@u0' }),
    S('countdown', { eyebrow: 'Drop 08', heading: 'Lands in', text: 'Sign up to get the link first.', buttonLabel: 'Notify me', buttonLink: '#newsletter', image: '@u1' }),
    S('insta-grid', { heading: 'Seen on the street', handle: '@staticnoise', images: [{ image: '@u0' }, { image: '@p0' }, { image: '@u1' }, { image: '@p1' }, { image: '@u2' }, { image: '@p5' }] }),
    S('newsletter', { heading: 'Get on the list', text: 'Drop alerts only. Never spam.' })],
  announcement: 'Free shipping over $100 | Drop 07 live now | No restocks', annStyle: 'marquee', payments: 'Card, Wallets',
});

def({
  id: 'boutique', name: 'Maison Clair', niche: 'Clothing boutique', category: 'Fashion', photos: 'fashion', description: 'Soft, editorial boutique with a lookbook feel.',
  theme: { colors: { background: '#fbf8f4', surface: '#f1ebe3', text: '#2a2522', muted: '#857a70', primary: '#2a2522', primaryText: '#fbf8f4', accent: '#a8754f', border: '#e7ded3' }, fonts: { heading: 'display', body: 'avenir' }, headingWeight: 400, radius: 2, buttons: 'solid', density: 'airy', headerStyle: 'centered', imageRatio: 'portrait', headingScale: 'huge', tracking: 'tight', shadow: 'none' },
  art: ['#f1ebe3', '#a8754f'], swatches: ['#d6c3ad', '#2a2522', '#9fb29f', '#c9a7a0'], heroArt: 'dress',
  products: [['Cream Knit Poncho', 148, 0, 'jacket', 'Knitwear', { Size: SML, Color: ['Cream', 'Oat'] }, { ph: ['@p2', '@u3'], rating: 4.9, reviews: 54, tags: ['new'] }], ['Camel Tailored Blazer', 268, 320, 'jacket', 'Tailoring', { Size: SIZES }, { ph: ['@u4', '@p5'] }], ['Relaxed Linen Shirt', 98, 0, 'tshirt', 'Tops', { Size: SIZES, Color: ['Sage', 'White'] }, { ph: ['@p3', '@u0'] }], ['Everyday Cotton Tee', 48, 0, 'tshirt', 'Tops', { Size: SIZES }, { ph: ['@p0', '@u1'] }], ['Washed Denim Jacket', 185, 0, 'jacket', 'Tailoring', { Size: SML }, { ph: ['@p5', '@u1'] }], ['Lounge Sweatshirt', 110, 0, 'hoodie', 'Knitwear', { Size: SIZES }, { ph: ['@p4', '@u2'] }]],
  home: [S('hero', { layout: 'carousel', heading: 'Quiet pieces, made to last', slides: [{ image: '@u4', heading: 'Quiet pieces, made to last', text: 'Natural fabrics, considered cuts and a palette you can wear every day.', buttonLabel: 'Shop new in', buttonLink: 'collection:all' }, { image: '@h2', heading: 'The autumn edit', text: 'Soft knits and tailoring in warm neutrals.', buttonLabel: 'Discover', buttonLink: 'collection:all' }, { image: '@u3', heading: 'Made in small batches', text: 'Cut and finished by hand in a family atelier.', buttonLabel: 'Our story', buttonLink: 'page:about' }], height: 'full', overlay: 25, autoplay: 7 }),
    S('collection-list', { heading: 'Shop by category', columns: 3, style: 'tall' }),
    S('featured-products', { eyebrow: 'New in', heading: 'This season’s favourites', columns: 4 }),
    S('image-text', { eyebrow: 'The atelier', heading: 'We make less, and make it better', text: 'Every piece is cut in a family-run atelier and finished by hand. Natural fibres, honest prices, no seasonal waste.', buttonLabel: 'Our story', buttonLink: 'page:about', imageSide: 'right', image: '@h2' }),
    S('testimonials', { eyebrow: 'Kind words', heading: 'Loved by our customers', items: Q(['The blazer fits like it was made for me.', 'Clara D.', 'Paris', '@u4'], ['Beautiful fabrics and the packaging is a gift in itself.', 'Amélie R.', 'Lyon', '@u3'], ['My go-to for pieces that last.', 'Noah B.', 'Brussels', '@u2']) }),
    S('insta-grid', { heading: 'Worn by you', handle: '@maisonclair', images: [{ image: '@u0' }, { image: '@u1' }, { image: '@p2' }, { image: '@u3' }, { image: '@u4' }, { image: '@p3' }] }),
    S('newsletter', { heading: 'Letters from the atelier', text: 'New collections and private sales, first.', image: '@h2' })],
  currency: ['EUR', 'fr-FR'], announcement: 'Complimentary shipping & returns within the EU', payments: 'Card, Wallets, Bank transfer',
});

def({
  id: 'sneakers', name: 'Solegrid', niche: 'Sneakers', category: 'Fashion', photos: 'sneakers', description: 'Premium sneaker store: warm photo hero, serif display type and category cards.',
  theme: { colors: { background: '#faf6f1', surface: '#efe6dc', text: '#1d1410', muted: '#7b6a5e', primary: '#1d1410', primaryText: '#f6ead8', accent: '#c4622d', border: '#e6dace' }, fonts: { heading: 'display', body: 'inter' }, headingWeight: 600, radius: 26, buttons: 'pill', density: 'comfortable', headerStyle: 'split', cardStyle: 'plain', imageRatio: 'square', headingScale: 'huge', tracking: 'tight' },
  art: ['#efe6dc', '#c4622d'], swatches: ['#1d1410', '#ffffff', '#c4622d', '#7b6a5e'], heroArt: 'sneaker',
  products: [['Dune Leather Low', 149, 0, 'sneaker', 'Women', { Size: ['37', '38', '39', '40', '41'], Color: ['Sand', 'White'] }, { ph: ['@p0', '@p2'], rating: 4.8, reviews: 214, tags: ['new'] }], ['Prism Chunky Runner', 169, 199, 'sneaker', 'Men', { Size: ['41', '42', '43', '44', '45'], Color: ['Coral', 'Sky'] }, { ph: ['@p1', '@h1'], rating: 4.7, reviews: 98 }], ['Court Classic White', 119, 0, 'sneaker', 'Women', { Size: ['36', '37', '38', '39', '40', '41'] }, { ph: ['@p2', '@p0'], rating: 4.9, reviews: 341 }], ['Aero Mesh Trainer', 139, 0, 'sneaker', 'Men', { Size: ['41', '42', '43', '44'], Color: ['Grey', 'Black'] }, { ph: ['@p3', '@p1'], rating: 4.6, reviews: 75 }], ['Mini Court (kids)', 69, 0, 'sneaker', 'Kids', { Size: ['28', '30', '32', '34'] }, { ph: ['@p2', '@p3'] }], ['Sneaker Care Kit', 24, 0, 'bottle', 'Accessories', null, { ph: ['@p3', '@h1'] }]],
  home: [S('hero', { layout: 'carousel', heading: 'Sneakers That Defy Your Everyday Look', slides: [{ image: '@h0', heading: 'Sneakers That Defy Your Everyday Look', text: 'Hand-finished leather, cushioned soles and colours made for city streets.', buttonLabel: 'Shop Now', buttonLink: 'collection:all' }, { image: '@h1', heading: 'Colour that keeps up with you', text: 'Meet the Prism runner — bold, light and ready to move.', buttonLabel: 'Shop Now', buttonLink: 'collection:all' }], height: 'full', overlay: 22, autoplay: 6, background: '#5a3826', textColor: '#f6ead8' }),
    S('collection-list', { heading: 'Shop by category', columns: 4, style: 'tall' }),
    S('featured-products', { eyebrow: 'Best sellers', heading: 'Loved by the crew', columns: 4 }),
    S('features', { style: 'strip', columns: 4, items: STRIP }),
    S('bento', { heading: 'Made to move', items: [{ image: '@h1', title: 'The Prism collection', text: 'Chunky soles, bright colourways.', link: 'collection:all' }, { image: '@p0', title: 'Hand-finished leather', text: 'Soft from day one.', link: '' }, { image: '@p3', title: 'Free size swaps', text: 'Wrong size? We swap it free.', link: 'page:contact' }] }),
    S('testimonials', { items: Q(['Most comfortable pair I own — and the compliments never stop.', 'Imani J.', 'Verified buyer'], ['Arrived in two days, fits true to size.', 'Lucas F.', 'Verified buyer'], ['The leather is buttery soft. Ordering a second colour.', 'Sara P.', 'Verified buyer']) }),
    S('newsletter', { eyebrow: 'Members get 10% off', heading: 'Join the Solegrid crew', text: 'Early access to drops and member-only colourways.', image: '@h1' })],
  announcement: 'Free shipping over $75 | Free size swaps | New: the Prism runner', annStyle: 'marquee', payments: 'Card, Wallets',
  nav: ['Women', 'Men', 'Kids', 'Accessories'],
});

def({
  id: 'furniture', name: 'Oak & Row', niche: 'Furniture', category: 'Home & living', photos: 'furniture', description: 'Calm furniture showroom with rooms, craft story and bento.',
  theme: { colors: { background: '#f6f3ee', surface: '#ebe5dc', text: '#2d2a26', muted: '#7d766c', primary: '#3b4a3f', primaryText: '#f6f3ee', accent: '#b07d4f', border: '#ddd5c9' }, fonts: { heading: 'iowan', body: 'avenir' }, headingWeight: 500, radius: 18, buttons: 'pill', density: 'airy', headerStyle: 'split', imageRatio: 'landscape', headingScale: 'large', tracking: 'tight' },
  art: ['#ebe5dc', '#b07d4f'], swatches: ['#8b6b4a', '#3b4a3f', '#c2a27c', '#5c5c5c'], heroArt: 'sofa',
  products: [['Haven Velvet Sofa', 1490, 0, 'sofa', 'Living room', { Fabric: ['Moss', 'Oat', 'Charcoal'] }, { ph: ['@p0', '@h2'], rating: 4.9, reviews: 61 }], ['Cloud Tufted Armchair', 620, 720, 'chair', 'Living room', { Fabric: ['Cream', 'Sand'] }, { ph: ['@p1', '@h1'], rating: 4.8, reviews: 40 }], ['Linen Upholstered Bed', 1290, 0, 'sofa', 'Bedroom', { Size: ['Double', 'Queen', 'King'] }, { ph: ['@p2', '@h3'] }], ['Row Dresser', 780, 0, 'table', 'Bedroom', null, { ph: ['@p3', '@h0'] }], ['Lounge Chair', 540, 0, 'chair', 'Living room', null, { ph: ['@h1', '@p1'] }], ['Loft Sofa', 1680, 0, 'sofa', 'Living room', null, { ph: ['@h3', '@p0'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'New collection', heading: 'Furniture for slow living', text: 'Solid wood, natural fabrics, built to be handed down.', buttonLabel: 'Shop the collection', buttonLink: 'collection:all', button2Label: 'Visit the showroom', button2Link: 'page:contact', overlay: 30, image: '@h0', height: 'full' }),
    S('collection-list', { heading: 'Shop by room', columns: 3, style: 'wide' }),
    S('featured-products', { eyebrow: 'Signature pieces', heading: 'Made to be lived with', columns: 3 }),
    S('image-text', { eyebrow: 'Our workshop', heading: 'Crafted slowly, by hand', text: 'Every frame is built from FSC-certified hardwood and finished with natural oils by our small team.', buttonLabel: 'Our story', buttonLink: 'page:about', layout: 'overlap', image: '@h3' }),
    S('bento', { heading: 'The Oak & Row promise', items: [{ image: '@h1', title: 'White-glove delivery', text: 'Placed in your room, packaging taken away.', link: '' }, { image: null, title: '10-year frame warranty', text: 'Built to outlast trends.', link: '' }, { image: '@h2', title: '100-night trial', text: 'Live with it before you decide.', link: 'page:contact' }] }),
    S('testimonials', { items: Q(['The sofa is even better in person.', 'Grace N.'], ['Solid, beautiful and delivered with care.', 'Peter J.'], ['Our bedroom finally feels finished.', 'Amara O.']) }),
    S('newsletter', { heading: 'Room ideas, monthly', text: 'Styling notes and early access to new pieces.' })],
  announcement: 'White-glove delivery included on all furniture', payments: 'Card, Bank transfer',
});

def({
  id: 'homedecor', name: 'Nest Theory', niche: 'Home decor', category: 'Home & living', photos: 'decor', description: 'Earthy decor shop with candles, ceramics and cosy rooms.',
  theme: { colors: { background: '#fdf8f3', surface: '#f3e7dc', text: '#3a2f2a', muted: '#8a7568', primary: '#b4553a', primaryText: '#ffffff', accent: '#6f8f72', border: '#ead9cb' }, fonts: { heading: 'palatino', body: 'avenir' }, headingWeight: 600, radius: 24, buttons: 'pill', headerStyle: 'split', cardStyle: 'plain', imageRatio: 'portrait', headingScale: 'large', tracking: 'tight' },
  art: ['#f3e7dc', '#6f8f72'], swatches: ['#b4553a', '#6f8f72', '#e2c9a6', '#3a2f2a'], heroArt: 'vase',
  products: [['Glow Jar Candle', 28, 0, 'candle', 'Candles', { Scent: ['Fig', 'Cedar', 'Linen'] }, { ph: ['@p0', '@p1'], rating: 4.9, reviews: 187 }], ['Amber Glass Candle', 32, 0, 'candle', 'Candles', null, { ph: ['@p1', '@p2'], tags: ['new'] }], ['Twin Amber Candles', 44, 52, 'candle', 'Candles', null, { ph: ['@p2', '@p0'] }], ['Mint Pot Succulent', 22, 0, 'plant', 'Greenery', null, { ph: ['@p3', '@h1'] }], ['Reading Corner Set', 189, 0, 'chair', 'Living', null, { ph: ['@h1', '@p3'] }]],
  home: [S('hero', { layout: 'split', eyebrow: 'Handmade homewares', heading: 'Make home feel like you', text: 'Small-batch candles, ceramics and textiles for slow evenings.', buttonLabel: 'Shop decor', buttonLink: 'collection:all', image: '@h0', background: '#f3e7dc' }),
    S('features', { style: 'strip', columns: 4, items: STRIP }),
    S('featured-products', { eyebrow: 'Loved this month', heading: 'Cosy essentials', columns: 4 }),
    S('banner', { eyebrow: 'Gift guide', heading: 'Thoughtful gifts under $50', text: 'Wrapped by hand, ready to give.', buttonLabel: 'Find a gift', buttonLink: 'collection:all', style: 'image', image: '@h0' }),
    S('gallery', { heading: 'In real homes', columns: 3, images: [{ image: '@h1' }, { image: '@p1' }, { image: '@p3' }] }),
    S('newsletter', { heading: 'Slow living, in your inbox', text: '10% off your first order.' })],
});

def({
  id: 'general', name: 'Everyday Goods', niche: 'General store', category: 'General', photos: 'general', description: 'Clean all-purpose shop for any catalogue.',
  theme: { colors: { background: '#ffffff', surface: '#f3f5f8', text: '#0f172a', muted: '#64748b', primary: '#2563eb', primaryText: '#ffffff', accent: '#2563eb', border: '#e2e8f0' }, fonts: { heading: 'inter', body: 'inter' }, headingWeight: 800, radius: 18, buttons: 'pill', headerStyle: 'split', cardStyle: 'plain', imageRatio: 'square', headingScale: 'large', tracking: 'tight' },
  art: ['#eef2f7', '#2563eb'], swatches: ['#2563eb', '#0f172a', '#10b981', '#f59e0b', '#ef4444'], heroArt: 'box',
  products: [['Gift Bag Set', 19, 0, 'bag', 'Home', { Color: ['Red', 'Black'] }, { ph: ['@p0', '@h0'], rating: 4.7, reviews: 63 }], ['Desk Essentials Kit', 79, 95, 'laptop', 'Tech', null, { ph: ['@p1', '@p3'], rating: 4.6, reviews: 51 }], ['Glass Candle', 24, 0, 'candle', 'Home', null, { ph: ['@p2', '@h1'] }], ['Studio Headphones', 129, 0, 'headphones', 'Tech', { Color: ['Black', 'Yellow'] }, { ph: ['@p3', '@p1'], rating: 4.8, reviews: 140, tags: ['new'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Open daily', heading: 'Good things for every day', text: 'Useful, well-made products at fair prices.', buttonLabel: 'Shop all', buttonLink: 'collection:all', overlay: 40, image: '@h0' }),
    S('features', { style: 'strip', columns: 4, items: STRIP }),
    S('collection-list', { heading: 'Shop by category', columns: 2, style: 'wide' }),
    S('featured-products', { eyebrow: 'Featured', heading: 'Customer favourites', columns: 4 }),
    S('banner', { heading: 'Visit the shop', text: 'Pick up your order in store, same day.', buttonLabel: 'Opening hours', buttonLink: 'page:contact', style: 'image', image: '@h1' }),
    S('logos', { heading: 'As seen in' }), S('faq', { items: FAQ_SHIP }), S('newsletter')],
});

def({
  id: 'electronics', name: 'Voltline', niche: 'Electronics', category: 'Tech', photos: 'tech', description: 'Sleek dark tech store with glowing gradient hero and bento.',
  theme: { colors: { background: '#0a0c10', surface: '#14181f', text: '#eef2f6', muted: '#8a96a8', primary: '#22d3ee', primaryText: '#04161a', accent: '#22d3ee', border: '#222a36' }, fonts: { heading: 'inter', body: 'inter' }, headingWeight: 700, radius: 22, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', imageRatio: 'square', headingScale: 'large', tracking: 'tight', shadow: 'strong' },
  art: ['#141a24', '#22d3ee'], swatches: ['#cbd5e1', '#334155', '#22d3ee', '#f8fafc'], heroArt: 'headphones',
  products: [['Pulse Wireless Headphones', 199, 249, 'headphones', 'Audio', { Color: ['Graphite', 'Yellow'] }, { ph: ['@p0', '@p1'], rating: 4.8, reviews: 512, tags: ['new'] }], ['Studio Over-Ear', 249, 0, 'headphones', 'Audio', { Color: ['White', 'Black'] }, { ph: ['@p1', '@p0'], rating: 4.7, reviews: 201 }], ['Orbit Smartwatch', 249, 0, 'watch', 'Wearables', { Size: ['41 mm', '45 mm'] }, { ph: ['@p2', '@h0'], rating: 4.6, reviews: 158 }], ['Volt 14 Laptop', 1299, 1399, 'laptop', 'Computers', { Memory: ['16 GB', '32 GB'] }, { ph: ['@p3', '@h1'] }], ['Creator Desk Bundle', 1499, 0, 'laptop', 'Computers', null, { ph: ['@h0', '@p3'] }]],
  home: [S('hero', { layout: 'gradient', eyebrow: 'New · Pulse', heading: 'Sound, sharpened', text: 'Pulse wireless headphones with 40-hour battery and adaptive noise cancelling.', buttonLabel: 'Shop Pulse', buttonLink: 'collection:all', button2Label: 'All products', button2Link: 'collection:all', image: '@p0', background: '#070a10', textColor: '#eef2f6' }),
    S('product-carousel', { eyebrow: 'Trending', heading: 'Most wanted right now' }),
    S('bento', { heading: 'Why Voltline', items: [{ image: '@h0', title: 'Your whole setup', text: 'Laptops, audio and wearables that just work together.', link: 'collection:all' }, { image: null, title: 'Next-day shipping', text: 'Order by 3 pm.', link: '' }, { image: null, title: '2-year warranty', text: 'On every device.', link: '' }, { image: '@h1', title: 'Trade in, trade up', text: 'Credit for your old device.', link: 'page:contact' }] }),
    S('featured-products', { heading: 'Best sellers', columns: 3 }),
    S('faq', { items: FAQ_SHIP })],
  announcement: 'Next-day delivery on orders before 3 pm', payments: 'Card, Wallets',
});

def({
  id: 'skincare', name: 'Dew Ritual', niche: 'Beauty / skincare', category: 'Beauty', photos: 'beauty', description: 'Soft blush skincare brand with ingredient story.',
  theme: { colors: { background: '#fff8f6', surface: '#fbe9e4', text: '#3d2a2a', muted: '#9a7b78', primary: '#3d2a2a', primaryText: '#fff8f6', accent: '#d97a6a', border: '#f2dcd6' }, fonts: { heading: 'display', body: 'avenir' }, headingWeight: 400, radius: 28, buttons: 'pill', density: 'airy', headerStyle: 'centered', imageRatio: 'portrait', headingScale: 'huge', tracking: 'tight' },
  art: ['#fbe9e4', '#d97a6a'], swatches: ['#f4c7bd', '#ffffff', '#e8d5c4', '#d9a5a0'], heroArt: 'serum',
  products: [['Glow Vitamin C Serum', 48, 0, 'serum', 'Serums', { Size: ['15 ml', '30 ml'] }, { ph: ['@p0', '@h1'], rating: 4.9, reviews: 1204, tags: ['new'] }], ['Cloud Moisturiser', 42, 0, 'jar', 'Moisturisers', null, { ph: ['@h1', '@p0'], rating: 4.8, reviews: 642 }], ['Gentle Gel Cleanser', 26, 0, 'bottle', 'Cleansers', null, { ph: ['@p0', '@p1'] }], ['Brush & Blend Set', 54, 64, 'palette', 'Tools', null, { ph: ['@p1', '@h0'] }]],
  home: [S('hero', { layout: 'split', eyebrow: 'Clean, clinical, kind', heading: 'Skin that feels like you again', text: 'Gentle formulas with proven actives — dermatologist tested.', buttonLabel: 'Find your ritual', buttonLink: 'collection:all', image: '@h1', background: '#fbe9e4' }),
    S('marquee', { text: 'Vegan | Cruelty-free | Fragrance-free | Dermatologist tested', style: 'solid', speed: 34 }),
    S('featured-products', { eyebrow: 'The essentials', heading: 'Your daily ritual', columns: 4 }),
    S('bento', { heading: 'What is inside matters', items: [{ image: '@h1', title: 'Every ingredient listed', text: 'With its percentage. No secrets.', link: 'page:about' }, { image: null, title: 'Vegan & cruelty-free', text: 'Never tested on animals.', link: '' }, { image: '@h0', title: 'Recyclable packaging', text: 'Glass and aluminium.', link: '' }] }),
    S('testimonials', { items: Q(['My skin has never been calmer.', 'Nadia F.'], ['The serum is a game-changer.', 'Lucy T.'], ['Gentle and actually effective.', 'Ivy C.']) }),
    S('newsletter', { heading: 'Join the ritual', text: '10% off your first order.', image: '@h0' })],
  currency: ['GBP', 'en-GB'], payments: 'Card, Wallets',
});

def({
  id: 'jewelry', name: 'Aurelia', niche: 'Jewelry', category: 'Fashion', photos: 'jewelry', description: 'Black-and-gold fine jewellery boutique.',
  theme: { colors: { background: '#0f0d0b', surface: '#1a1714', text: '#f3ece1', muted: '#a89a86', primary: '#d4b06a', primaryText: '#0f0d0b', accent: '#d4b06a', border: '#2c2620' }, fonts: { heading: 'display', body: 'avenir' }, headingWeight: 400, headingCase: 'uppercase', radius: 0, buttons: 'outline', density: 'airy', headerStyle: 'centered', imageRatio: 'portrait', headingScale: 'large', tracking: 'wide', shadow: 'none' },
  art: ['#1a1714', '#d4b06a'], swatches: ['#d4b06a', '#e5e4e2', '#b76e79'], heroArt: 'ring',
  products: [['Pearl Strand', 340, 0, 'necklace', 'Necklaces', null, { ph: ['@p0', '@p1'], rating: 5, reviews: 38 }], ['Halo Pendant', 280, 0, 'necklace', 'Necklaces', { Metal: ['Gold', 'Rose gold'] }, { ph: ['@p1', '@h0'], rating: 4.9, reviews: 52 }], ['Fine Chain Bracelet', 190, 0, 'necklace', 'Bracelets', { Metal: ['Gold', 'Silver'] }, { ph: ['@p2', '@p3'] }], ['Rose Link Bracelet', 220, 260, 'necklace', 'Bracelets', { Metal: ['Rose gold'] }, { ph: ['@p3', '@p2'], tags: ['new'] }]],
  home: [S('hero', { layout: 'image', heading: 'Heirlooms, made today', text: 'Recycled gold. Ethically sourced stones.', buttonLabel: 'Discover', buttonLink: 'collection:all', align: 'center', overlay: 40, image: '@h0', height: 'full' }),
    S('collection-list', { heading: 'Collections', columns: 2, style: 'wide' }),
    S('featured-products', { heading: 'Signature pieces', columns: 4, buttonLabel: 'View all' }),
    S('rich-text', { eyebrow: 'Made by hand', text: 'Each piece is cast, set and polished by our goldsmiths. Complimentary engraving and lifetime care.', size: 'large' }),
    S('image-text', { heading: 'Lifetime care', text: 'Free cleaning, resizing and repairs for as long as you wear it.', image: '@p0', layout: 'full' }),
    S('testimonials', { items: Q(['The pendant is breathtaking.', 'Claire D.'], ['Beautiful packaging and service.', 'Andrew L.'], ['A piece I will wear forever.', 'Sofia R.']) })],
  announcement: 'Complimentary engraving on every order', payments: 'Card, Bank transfer',
});

def({
  id: 'coffee', name: 'Ember Roasters', niche: 'Coffee roaster', category: 'Food & drink', photos: 'coffee', description: 'Warm specialty coffee with grind & size options.',
  theme: { colors: { background: '#faf5ee', surface: '#efe3d3', text: '#2a1d15', muted: '#7d6656', primary: '#2a1d15', primaryText: '#faf5ee', accent: '#c8742b', border: '#e4d5c3' }, fonts: { heading: 'condensed', body: 'avenir' }, headingWeight: 800, headingCase: 'uppercase', radius: 14, buttons: 'pill', headerStyle: 'split', cardStyle: 'plain', imageRatio: 'portrait', headingScale: 'huge', tracking: 'normal' },
  art: ['#efe4d6', '#c8742b'], swatches: ['#6b3e26', '#2a1d15', '#a35c2e', '#3f5b3a'], heroArt: 'coffeebag',
  products: [['Ember House Blend', 16, 0, 'coffeebag', 'Coffee', { Size: ['250 g', '1 kg'], Grind: ['Whole bean', 'Filter', 'Espresso'] }, { ph: ['@p0', '@p1'], rating: 4.9, reviews: 832 }], ['Ethiopia Highland', 19, 0, 'coffeebag', 'Coffee', { Size: ['250 g', '1 kg'], Grind: ['Whole bean', 'Filter'] }, { ph: ['@p1', '@p0'], tags: ['new'] }], ['Espresso Kit', 64, 79, 'cup', 'Brewing', null, { ph: ['@p1', '@p2'] }], ['Café Latte Box', 22, 0, 'cup', 'Merch', null, { ph: ['@p2', '@p3'] }], ['Coffee Subscription', 30, 0, 'box', 'Subscriptions', { Frequency: ['Every 2 weeks', 'Monthly'] }, { ph: ['@p3', '@h0'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Roasted every Tuesday', heading: 'Small batch. Big flavour.', text: 'Seasonal single origins and our signature house blend.', buttonLabel: 'Shop coffee', buttonLink: 'collection:all', overlay: 45, image: '@h0', height: 'full' }),
    S('marquee', { text: 'Freshly roasted | Direct trade | Free shipping over 40 | Subscribe & save', style: 'accent', speed: 30 }),
    S('featured-products', { eyebrow: 'This week', heading: 'Fresh roasts', columns: 4 }),
    S('image-text', { eyebrow: 'Farm to cup', heading: 'We know every farmer by name', text: 'We buy directly from growers and pay well above fair-trade prices.', buttonLabel: 'Our sourcing', buttonLink: 'page:about', layout: 'full', image: '@h1' }),
    S('banner', { heading: 'Never run out', text: 'Subscribe and save 10% on every bag.', buttonLabel: 'Start a subscription', buttonLink: 'collection:all', style: 'solid' }),
    S('locations', { heading: 'Visit the roastery café', image: '@h0', items: [{ name: 'Roastery & Café', address: '48 Mill Road', hours: 'Mon–Fri 7:00–17:00\nSat–Sun 8:00–16:00' }] })],
  checkout: 'whatsapp', payments: 'Cash, Bank transfer',
});

def({
  id: 'bakery', name: 'Butter & Rye', niche: 'Bakery', category: 'Food & drink', photos: 'bakery', description: 'Friendly neighbourhood bakery with pre-orders.',
  theme: { colors: { background: '#fffaf0', surface: '#fbefd5', text: '#3b2a17', muted: '#8b7355', primary: '#3b2a17', primaryText: '#fffaf0', accent: '#e0a526', border: '#f1e1bd' }, fonts: { heading: 'rounded', body: 'avenir' }, headingWeight: 800, radius: 28, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', headingScale: 'large', tracking: 'tight' },
  art: ['#fbefd5', '#c2410c'], swatches: ['#d9a25b', '#b8763a', '#f3d6a4', '#8b5a2b'], heroArt: 'croissant',
  products: [['Butter Croissants (box of 4)', 12, 0, 'croissant', 'Pastries', null, { ph: ['@p1', '@p2'], rating: 4.9, reviews: 302 }], ['Country Sourdough', 8, 0, 'bread', 'Bread', null, { ph: ['@p0', '@h0'], rating: 4.9, reviews: 211 }], ['Pastry Selection Box', 24, 28, 'box', 'Boxes', null, { ph: ['@p2', '@p1'] }], ['Rustic Rye Loaf', 9, 0, 'bread', 'Bread', null, { ph: ['@h1', '@p0'] }]],
  home: [S('hero', { layout: 'split', eyebrow: 'Baked fresh at 5 am', heading: 'Warm bread, happy mornings', text: 'Pre-order for pick-up or local delivery.', buttonLabel: 'Order now', buttonLink: 'collection:all', image: '@h0', background: '#fbefd5' }),
    S('featured-products', { eyebrow: 'Today', heading: 'Fresh from the oven', columns: 4 }),
    S('features', { columns: 3, items: [{ icon: 'clock', title: 'Order by 8 pm', text: 'Ready next morning.' }, { icon: 'leaf', title: 'Real ingredients', text: 'Butter, flour and time.' }, { icon: 'truck', title: 'Local delivery', text: 'Within 5 km.' }] }),
    S('locations', { heading: 'Pick-up & hours', image: '@h0', items: [{ name: 'Butter & Rye', address: '7 Baker Street', hours: 'Tue–Sun 7:00–15:00', phone: '+1 555 0142' }] }),
    S('faq', { items: [{ q: 'Do you have gluten-free options?', a: 'Yes, ask us about our weekly gluten-free bakes.' }, { q: 'How far ahead should I order a cake?', a: 'At least 48 hours.' }] })],
  checkout: 'whatsapp', payments: 'Cash, Card',
});

def({
  id: 'restaurant', name: 'Saffron Table', niche: 'Restaurant menu & ordering', category: 'Food & drink', photos: 'restaurant', description: 'Restaurant with menu, takeaway ordering by WhatsApp and hours.',
  theme: { colors: { background: '#fffaf5', surface: '#f6e9dd', text: '#2b1410', muted: '#86625a', primary: '#8f1d1d', primaryText: '#fff7ed', accent: '#e39a17', border: '#ecd9c9' }, fonts: { heading: 'iowan', body: 'avenir' }, headingWeight: 600, radius: 20, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', imageRatio: 'landscape', headingScale: 'large', tracking: 'tight' },
  art: ['#f7ebe0', '#e39a17'], swatches: ['#9b1c1c', '#c2410c', '#65a30d', '#ca8a04'], heroArt: 'dish',
  products: [['Grill Platter', 24, 0, 'dish', 'Mains', { Spice: ['Mild', 'Medium', 'Hot'] }, { ph: ['@p0', '@h1'], rating: 4.8, reviews: 96 }], ['Wood-fired Pizza', 16, 0, 'pizza', 'Mains', { Size: ['Regular', 'Large'] }, { ph: ['@p1', '@p0'], rating: 4.9, reviews: 154 }], ['Salmon Bowl', 18, 0, 'dish', 'Bowls', null, { ph: ['@p2', '@p3'], tags: ['new'] }], ['Chef’s Tasting Plate', 32, 0, 'dish', 'Specials', null, { ph: ['@p3', '@h1'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Takeaway & dine-in', heading: 'Slow-cooked, spice-forward', text: 'Order online for pick-up, or book a table.', buttonLabel: 'View menu & order', buttonLink: 'collection:all', button2Label: 'Book a table', button2Link: 'page:contact', overlay: 50, image: '@h0', height: 'full' }),
    S('collection-list', { heading: 'The menu', columns: 4, style: 'square' }),
    S('featured-products', { eyebrow: 'Chef’s favourites', heading: 'Order tonight', columns: 4 }),
    S('image-text', { eyebrow: 'Our kitchen', heading: 'Family recipes, fire and time', text: 'Seasonal produce and a wood-fired oven at the heart of it all.', layout: 'overlap', image: '@h1' }),
    S('locations', { heading: 'Opening hours', image: '@h0', items: [{ name: 'Saffron Table', address: '91 Harbour Road', hours: 'Tue–Thu 17:00–22:00\nFri–Sun 12:00–23:00', phone: '+1 555 0190' }] }),
    S('testimonials', { items: Q(['The grill platter is the best in town.', 'Yusuf E.', 'Regular'], ['Ordered on WhatsApp, ready in 20 minutes.', 'Beth A.', 'Takeaway'], ['Warm staff, incredible food.', 'Marco P.', 'Guest']) })],
  checkout: 'whatsapp', announcement: 'Order by WhatsApp — ready for pick-up in 25 minutes', payments: 'Cash, Card',
});

def({
  id: 'plants', name: 'Fernwood', niche: 'Plant shop', category: 'Home & living', photos: 'plants', description: 'Fresh green plant shop with care guides.',
  theme: { colors: { background: '#f4f7f1', surface: '#e3ecdc', text: '#1b2a1c', muted: '#5f735c', primary: '#24452c', primaryText: '#f4f7f1', accent: '#d97941', border: '#d3e0cb' }, fonts: { heading: 'iowan', body: 'avenir' }, headingWeight: 600, radius: 24, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', imageRatio: 'portrait', headingScale: 'large', tracking: 'tight' },
  art: ['#e6efe0', '#d97941'], swatches: ['#2f5d3a', '#4d7c4f', '#7aa95c', '#1f4730'], heroArt: 'plant',
  products: [['Mint Pot Succulent', 19, 0, 'plant', 'Easy care', null, { ph: ['@p0', '@h0'], rating: 4.9, reviews: 410 }], ['Terracotta Cactus', 24, 0, 'plant', 'Easy care', { Size: ['Small', 'Large'] }, { ph: ['@p1', '@h0'], rating: 4.8, reviews: 233 }], ['Cactus Trio', 49, 59, 'plant', 'Sets', null, { ph: ['@h0', '@p1'], tags: ['new'] }], ['Potting Kit', 29, 0, 'vase', 'Care', null, { ph: ['@p2', '@p0'] }]],
  home: [S('hero', { layout: 'split', eyebrow: 'Delivered happy & healthy', heading: 'Bring the outside in', text: 'Healthy plants, care guides and a 30-day happiness guarantee.', buttonLabel: 'Shop plants', buttonLink: 'collection:all', image: '@h0', background: '#e3ecdc' }),
    S('collection-list', { heading: 'Find your plant', columns: 3, style: 'tall' }),
    S('featured-products', { eyebrow: 'Bestsellers', heading: 'Easy to love', columns: 4 }),
    S('features', { style: 'strip', columns: 3, items: [{ icon: 'leaf', title: 'Grown with care', text: 'From local nurseries' }, { icon: 'truck', title: 'Plant-safe shipping', text: 'Packed to arrive perfect' }, { icon: 'heart', title: '30-day guarantee', text: 'Free replacement if it struggles' }] }),
    S('faq', { items: [{ q: 'Are your plants pet-safe?', a: 'Each product page lists whether the plant is pet-safe.' }, ...FAQ_SHIP.slice(0, 2)] }),
    S('newsletter', { heading: 'Plant care tips', text: 'Seasonal care tips, monthly.', image: '@h0' })],
});

def({
  id: 'books', name: 'Dog-Ear Books', niche: 'Books', category: 'Hobbies & gifts', photos: 'books', description: 'Cosy independent bookshop with staff picks.',
  theme: { colors: { background: '#fbf7ef', surface: '#f0e8d8', text: '#26201a', muted: '#7a6e5f', primary: '#1f3a5f', primaryText: '#fbf7ef', accent: '#b23a2a', border: '#e3d8c3' }, fonts: { heading: 'garamond', body: 'iowan' }, headingWeight: 600, radius: 6, buttons: 'solid', headerStyle: 'centered', imageRatio: 'portrait', headingScale: 'huge', tracking: 'tight' },
  art: ['#f0e8d8', '#e8c547'], swatches: ['#1f3a5f', '#b23a2a', '#2f5d3a', '#6b4e9b', '#26201a'], heroArt: 'book',
  products: [['The Quiet Orchard (novel)', 18, 0, 'book', 'Fiction', { Format: ['Paperback', 'Hardcover'] }, { ph: ['@p0', '@h0'], rating: 4.7, reviews: 89 }], ['Maps of Small Places', 22, 0, 'book', 'Non-fiction', null, { ph: ['@p1', '@h1'] }], ['Midnight at the Lighthouse', 16, 0, 'book', 'Fiction', null, { ph: ['@h1', '@p0'], tags: ['new'] }], ['Book Club Box', 45, 0, 'box', 'Gifts', { Plan: ['1 month', '3 months'] }, { ph: ['@h0', '@p1'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Independent since 2009', heading: 'Stories worth staying up for', text: 'Hand-picked books, delivered with a handwritten note.', buttonLabel: 'Browse books', buttonLink: 'collection:all', image: '@h1', overlay: 45 }),
    S('featured-products', { eyebrow: 'Staff picks', heading: 'What we are reading', columns: 4 }),
    S('collection-list', { heading: 'Shelves', columns: 4, style: 'tall' }),
    S('rich-text', { eyebrow: 'The book club', text: 'Each month we send a surprise book chosen just for you, plus tea and a bookmark.', size: 'large' }),
    S('newsletter', { heading: 'New releases, weekly', image: '@h0' })],
});

def({
  id: 'pets', name: 'Wag & Whisker', niche: 'Pet supplies', category: 'Hobbies & gifts', photos: 'pets', description: 'Playful pet store with treats, toys and cosy wear.',
  theme: { colors: { background: '#ffffff', surface: '#e9f7f5', text: '#123a37', muted: '#5b7e7a', primary: '#0f8f82', primaryText: '#ffffff', accent: '#ffad14', border: '#d5ece9' }, fonts: { heading: 'rounded', body: 'avenir' }, headingWeight: 800, radius: 28, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', headingScale: 'large', tracking: 'tight' },
  art: ['#e9f7f5', '#ffad14'], swatches: ['#0f9d8f', '#ff6b6b', '#ffb020', '#5b6cff'], heroArt: 'bone',
  products: [['Cable Knit Dog Sweater', 34, 0, 'jacket', 'Dog wear', { Size: ['S', 'M', 'L'], Color: ['Cream', 'Navy'] }, { ph: ['@p0', '@h0'], rating: 4.9, reviews: 266, tags: ['new'] }], ['Sunny Pet Hoodie', 29, 36, 'hoodie', 'Dog wear', { Size: ['S', 'M', 'L'], Color: ['Yellow'] }, { ph: ['@p1', '@p0'], rating: 4.8, reviews: 140 }], ['Cat Window Perch', 49, 0, 'cushion', 'Cats', null, { ph: ['@p2', '@h0'] }], ['Adventure Leash Set', 24, 0, 'bag', 'Walk', null, { ph: ['@h0', '@p1'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'For dogs & cats', heading: 'Happy pets, happy homes', text: 'Cosy wear, toys and treats your pet will love.', buttonLabel: 'Shop now', buttonLink: 'collection:all', image: '@h0', overlay: 30, height: 'full' }),
    S('collection-list', { heading: 'Shop by pet', columns: 3, style: 'square' }),
    S('featured-products', { eyebrow: 'Tail-wagging favourites', heading: 'Most loved', columns: 4 }),
    S('banner', { heading: 'Build a bundle, save 15%', text: 'Mix any three toys or treats.', buttonLabel: 'Start a bundle', buttonLink: 'collection:all', style: 'solid' }),
    S('testimonials', { items: Q(['My pug has not taken the sweater off for a week.', 'Jess M.'], ['Great quality and fast delivery.', 'Ahmed R.'], ['Our cat loves the perch.', 'Lina S.']) }), S('newsletter')],
});

def({
  id: 'toys', name: 'Tiny Giants', niche: 'Kids toys', category: 'Hobbies & gifts', photos: 'toys', description: 'Bright, rounded toy shop with wooden classics.',
  theme: { colors: { background: '#fffdf7', surface: '#fff1d6', text: '#1e1b4b', muted: '#6b6894', primary: '#6d28d9', primaryText: '#ffffff', accent: '#f43f5e', border: '#f3e5c4' }, fonts: { heading: 'rounded', body: 'rounded' }, headingWeight: 900, radius: 32, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', headingScale: 'large', tracking: 'tight' },
  art: ['#fff1d6', '#f43f5e'], swatches: ['#6d28d9', '#10b981', '#f59e0b', '#3b82f6', '#f43f5e'], heroArt: 'rocket',
  products: [['Wooden Train Set', 54, 0, 'blocks', 'Ages 3–6', null, { ph: ['@p0', '@p1'], rating: 4.9, reviews: 188, tags: ['new'] }], ['Retro Robot Collection', 39, 49, 'rocket', 'Ages 6+', null, { ph: ['@p1', '@p0'], rating: 4.7, reviews: 64 }], ['Train Station Add-on', 29, 0, 'blocks', 'Ages 3–6', null, { ph: ['@h0', '@p1'] }], ['Tin Car Duo', 24, 0, 'rocket', 'Ages 6+', null, { ph: ['@p1', '@h0'] }]],
  home: [S('hero', { layout: 'gradient', heading: 'Play big, grow bigger', text: 'Safe, sustainable toys for curious kids.', buttonLabel: 'Shop toys', buttonLink: 'collection:all', image: '@h0' }),
    S('collection-list', { heading: 'Shop by age', columns: 2, style: 'wide' }),
    S('featured-products', { heading: 'Top toys', columns: 4 }),
    S('features', { columns: 3, items: [{ icon: 'shield', title: 'Safety tested', text: 'Meets EN71 & ASTM standards.' }, { icon: 'leaf', title: 'Sustainable', text: 'FSC wood and recycled plastics.' }, { icon: 'gift', title: 'Free gift wrap', text: 'Add a note at checkout.' }] }),
    S('faq', { items: FAQ_SHIP })],
});

def({
  id: 'artprints', name: 'Inkwell Prints', niche: 'Art prints', category: 'Home & living', photos: 'art', description: 'Minimal gallery-style art print shop.',
  theme: { colors: { background: '#ffffff', surface: '#f5f5f3', text: '#141414', muted: '#7a7a76', primary: '#141414', primaryText: '#ffffff', accent: '#d9472b', border: '#ebebe8' }, fonts: { heading: 'inter', body: 'inter' }, headingWeight: 500, radius: 0, buttons: 'sharp', density: 'airy', headerStyle: 'minimal', imageRatio: 'portrait', headingScale: 'huge', tracking: 'tight', shadow: 'none' },
  art: ['#f6f6f4', '#e76f51'], swatches: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'], heroArt: 'print',
  products: [['Still Life No. 3', 55, 0, 'print', 'Botanical', { Size: ['A4', 'A3', 'A2'], Frame: ['No frame', 'Black', 'Oak'] }, { ph: ['@p0', '@h1'], rating: 4.9, reviews: 77 }], ['Face in Colour', 65, 0, 'print', 'Street', { Size: ['A3', 'A2'] }, { ph: ['@p1', '@h0'], tags: ['new'] }], ['Red Stroke', 45, 60, 'print', 'Abstract', { Size: ['A4', 'A3'] }, { ph: ['@p2', '@p0'] }], ['Mural Study', 55, 0, 'print', 'Street', { Size: ['A3', 'A2'] }, { ph: ['@h0', '@p2'] }]],
  home: [S('hero', { layout: 'text', heading: 'Art for quiet walls', text: 'Giclée prints on archival cotton paper. Signed and numbered.', buttonLabel: 'View the collection', buttonLink: 'collection:all' }),
    S('gallery', { heading: '', columns: 3, images: [{ image: '@h0' }, { image: '@p0' }, { image: '@p2' }] }),
    S('featured-products', { heading: 'Editions', columns: 4, buttonLabel: 'All prints' }),
    S('rich-text', { text: 'Museum-grade pigment inks on 310 gsm cotton rag. Ships flat in recycled packaging.', size: 'large', align: 'left' }),
    S('newsletter', { heading: 'New editions', text: 'Be first to see new releases.' })],
  announcement: 'Free framing on orders over $150',
});

def({
  id: 'digital', name: 'Pixel Pantry', niche: 'Digital downloads', category: 'Digital', photos: 'digital', description: 'Vivid digital product store for templates and presets.',
  theme: { colors: { background: '#0d0919', surface: '#1a1333', text: '#f3efff', muted: '#a69bc9', primary: '#a855f7', primaryText: '#ffffff', accent: '#f472b6', border: '#2b2250' }, fonts: { heading: 'inter', body: 'inter' }, headingWeight: 800, radius: 22, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', imageRatio: 'landscape', headingScale: 'large', tracking: 'tight', shadow: 'strong' },
  art: ['#1a1333', '#f472b6'], swatches: ['#a855f7', '#22d3ee', '#f472b6', '#facc15'], heroArt: 'file',
  products: [['Notion Life Planner', 24, 0, 'grid', 'Templates', null, { rating: 4.9, reviews: 920, tags: ['new'] }], ['Dashboard UI Kit', 49, 69, 'grid', 'Templates', { License: ['Personal', 'Commercial'] }, { rating: 4.8, reviews: 311 }], ['Code Snippet Library', 29, 0, 'file', 'Developer'], ['Creator Bundle', 89, 128, 'box', 'Bundles', null, { featured: true }]],
  home: [S('hero', { layout: 'gradient', eyebrow: 'Instant digital downloads', heading: 'Templates that do the boring part', text: 'Planners, UI kits and code used by 20,000+ creators.', buttonLabel: 'Browse downloads', buttonLink: 'collection:all', image: '@h0', background: '#120c24', textColor: '#f3efff' }),
    S('featured-products', { heading: 'Best sellers', columns: 4 }),
    S('bento', { heading: 'Built for makers', items: [{ image: '@p1', title: 'Ready in minutes', text: 'Duplicate, customise, ship.', link: 'collection:all' }, { image: null, title: 'Lifetime updates', text: 'Every new version included.', link: '' }, { image: '@p2', title: 'Commercial licence', text: 'Use in client work.', link: '' }] }),
    S('testimonials', { items: Q(['Saved me hours every week.', 'Kim N.', 'Creator'], ['Beautiful and easy to customise.', 'Dev P.', 'Designer'], ['Worth every penny.', 'Ana G.', 'Freelancer']) }),
    S('faq', { items: [{ q: 'How do I get my files?', a: 'After payment, we email your download link within a few hours.' }, { q: 'Can I use them commercially?', a: 'Choose the Commercial licence where offered.' }] })],
  checkout: 'paymentLinks', payments: 'Card, Wallets',
});

def({
  id: 'beats', name: 'Low End Theory', niche: 'Music / beats', category: 'Digital', photos: 'music', description: 'Dark producer store with beat licences.',
  theme: { colors: { background: '#09090b', surface: '#16161a', text: '#fafafa', muted: '#9a9aa5', primary: '#ff2e88', primaryText: '#ffffff', accent: '#ff2e88', border: '#26262c' }, fonts: { heading: 'condensed', body: 'inter' }, headingWeight: 800, headingCase: 'uppercase', radius: 14, buttons: 'pill', density: 'compact', headerStyle: 'split', cardStyle: 'card', imageRatio: 'square', headingScale: 'huge', tracking: 'normal', shadow: 'strong' },
  art: ['#16161a', '#ff2e88'], swatches: ['#ff2e88', '#7c3aed', '#06b6d4', '#f59e0b'], heroArt: 'vinyl',
  products: [['Midnight Drive — 92 BPM', 29, 0, 'wave', 'Beats', { License: ['MP3 Lease', 'WAV Lease', 'Unlimited'] }, { ph: ['@p0', '@h0'], tags: ['new'] }], ['Neon Rain — 140 BPM', 29, 0, 'wave', 'Beats', { License: ['MP3 Lease', 'WAV Lease', 'Unlimited'] }, { ph: ['@h1', '@p1'] }], ['Gold Teeth — 85 BPM', 29, 0, 'vinyl', 'Beats', { License: ['MP3 Lease', 'WAV Lease', 'Unlimited'] }, { ph: ['@p1', '@p0'] }], ['Mixing Session (1 song)', 99, 0, 'headphones', 'Services', null, { ph: ['@h0', '@p1'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Beats · Kits · Mixing', heading: 'Sounds that hit different', text: 'Lease a beat in minutes. Exclusive rights on request.', buttonLabel: 'Browse beats', buttonLink: 'collection:all', overlay: 55, image: '@h1', height: 'full' }),
    S('marquee', { text: 'Trap | Lo-fi | Drill | R&B | Afro | Boom bap', style: 'outline', speed: 24 }),
    S('featured-products', { heading: 'Latest beats', columns: 4 }),
    S('pricing', { heading: 'Licences', plans: [{ name: 'MP3 Lease', price: '29', period: '', features: 'MP3 file\n5,000 streams\nCredit required', buttonLabel: 'Browse', buttonLink: 'collection:all' }, { name: 'WAV Lease', price: '49', period: '', features: 'WAV + MP3\n50,000 streams\nMusic video rights', buttonLabel: 'Browse', buttonLink: 'collection:all', highlight: true }, { name: 'Unlimited', price: '149', period: '', features: 'Track stems\nUnlimited streams\nRadio rights', buttonLabel: 'Browse', buttonLink: 'collection:all' }] }),
    S('image-text', { eyebrow: 'Studio', heading: 'Mixed in a real room', text: 'Analogue outboard, treated room, fast turnaround.', buttonLabel: 'Book a mix', buttonLink: 'collection:all', image: '@h0', layout: 'full' }),
    S('newsletter', { heading: 'Free beat every month' })],
  checkout: 'paymentLinks', payments: 'Card, Wallets',
});

def({
  id: 'agency', name: 'Fieldwork Studio', niche: 'Agency services', category: 'Services', photos: 'business', description: 'Confident agency site selling productised services.',
  theme: { colors: { background: '#f4f3ef', surface: '#e8e6df', text: '#111111', muted: '#66645e', primary: '#111111', primaryText: '#f4f3ef', accent: '#ff4d00', border: '#d9d6cc' }, fonts: { heading: 'inter', body: 'inter' }, headingWeight: 700, radius: 20, buttons: 'pill', density: 'airy', headerStyle: 'split', imageRatio: 'landscape', headingScale: 'huge', tracking: 'tight', shadow: 'none' },
  art: ['#e9e7e0', '#ff4d00'], swatches: ['#111111', '#ff4d00', '#66645e'], heroArt: 'grid',
  products: [['Brand Identity Sprint', 4500, 0, 'grid', 'Branding'], ['Website Design & Build', 8900, 0, 'laptop', 'Web'], ['Launch Campaign', 3200, 0, 'rocket', 'Marketing'], ['Strategy Workshop', 1200, 0, 'target', 'Strategy', null, { ph: ['@h0', '@p0'] }], ['Monthly Design Retainer', 2800, 0, 'users', 'Retainers', { Hours: ['20 h / month', '40 h / month'] }, { ph: ['@h1', '@p1'] }]],
  home: [S('hero', { layout: 'text', eyebrow: 'Independent design studio', heading: 'We make brands people remember.', text: 'Fixed-price design sprints for startups and growing companies.', buttonLabel: 'See services', buttonLink: 'collection:all', button2Label: 'Get in touch', button2Link: 'page:contact' }),
    S('logos', { heading: 'Trusted by', items: [{ name: 'Northwind' }, { name: 'Copperline' }, { name: 'Halcyon' }, { name: 'Basecamp Coffee' }, { name: 'Tandem' }] }),
    S('bento', { eyebrow: 'Selected work', heading: 'Results, not decks', items: [{ image: '@h0', title: 'Copperline rebrand', text: 'Identity, packaging and site in 6 weeks.', link: 'collection:all' }, { image: '@p0', title: '2× conversion', text: 'Halcyon website relaunch.', link: '' }, { image: '@h1', title: 'Workshops that land', text: 'Strategy in one day.', link: 'page:contact' }] }),
    S('pricing', { eyebrow: 'Services', heading: 'Productised, fixed price', plans: [{ name: 'Identity Sprint', price: '4500', period: '2 weeks', features: 'Logo & wordmark\nColour & type system\nBrand guidelines', buttonLabel: 'Book a sprint', buttonLink: 'collection:all' }, { name: 'Website', price: '8900', period: '4–6 weeks', features: 'Design & build\nCMS setup\nLaunch support', buttonLabel: 'Start a project', buttonLink: 'collection:all', highlight: true }, { name: 'Retainer', price: '2800', period: '/ month', features: 'Dedicated designer\nWeekly check-ins\nCancel any time', buttonLabel: 'Talk to us', buttonLink: 'page:contact' }] }),
    S('image-text', { eyebrow: 'Process', heading: 'Short sprints, clear outcomes', text: 'Focused sprints with defined deliverables. You always know what you get and when.', buttonLabel: 'Our process', buttonLink: 'page:about', image: '@p1' }),
    S('testimonials', { items: Q(['They understood us in one workshop.', 'Lena H.', 'CEO, Copperline'], ['On time, on budget, on brand.', 'Sam B.', 'Founder, Tandem'], ['Our conversion rate doubled after launch.', 'Ravi K.', 'CMO, Halcyon']) }),
    S('faq', { items: [{ q: 'How do we start?', a: 'Choose a service and send the order — we schedule a kickoff call within two days.' }, { q: 'Do you work internationally?', a: 'Yes, we work remotely with clients worldwide.' }] })],
  checkout: 'email',
});

def({
  id: 'cosmetics', name: 'Chroma Lab', niche: 'Cosmetics', category: 'Beauty', photos: 'beauty', description: 'Bold colour cosmetics with shade swatches.',
  theme: { colors: { background: '#fff5f7', surface: '#ffe3ea', text: '#2a0a14', muted: '#8c5566', primary: '#c8105a', primaryText: '#ffffff', accent: '#c8105a', border: '#f8cfd9' }, fonts: { heading: 'condensed', body: 'avenir' }, headingWeight: 800, headingCase: 'uppercase', radius: 24, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', headingScale: 'huge', tracking: 'normal' },
  art: ['#ffe4ea', '#2a0a14'], swatches: ['#d6195f', '#9f1239', '#f472b6', '#be123c', '#fb7185'], heroArt: 'lipstick',
  products: [['Velvet Matte Lipstick', 22, 0, 'lipstick', 'Lips', { Shade: ['Ruby', 'Rose', 'Nude', 'Berry'] }, { ph: ['@p1', '@h0'], rating: 4.8, reviews: 1532, tags: ['new'] }], ['Pro Brush Set', 34, 42, 'palette', 'Tools', null, { ph: ['@h0', '@p1'], rating: 4.7, reviews: 402 }], ['Silk Primer', 28, 0, 'bottle', 'Face', null, { ph: ['@p0', '@h1'] }], ['Glow Highlighter', 26, 0, 'palette', 'Face', { Shade: ['Champagne', 'Rose gold'] }, { ph: ['@p1', '@p0'] }]],
  home: [S('hero', { layout: 'carousel', heading: 'Colour loud', slides: [{ image: '@h0', heading: 'Colour loud', text: '12-hour velvet colour in four bold shades.', buttonLabel: 'Shop lips', buttonLink: 'collection:all' }, { image: '@h1', heading: 'Prep. Prime. Glow.', text: 'Skin-first base that lasts all day.', buttonLabel: 'Shop face', buttonLink: 'collection:all' }], height: 'full', overlay: 25, autoplay: 5 }),
    S('marquee', { text: 'Vegan | Cruelty-free | Long-wear | 40 shades', style: 'accent', speed: 22 }),
    S('product-carousel', { heading: 'Trending shades' }),
    S('countdown', { eyebrow: 'Flash sale', heading: '20% off brushes', text: 'For 48 hours only.', buttonLabel: 'Shop the sale', buttonLink: 'collection:all', image: '@h0' }),
    S('featured-products', { heading: 'Cult favourites', columns: 4 }),
    S('insta-grid', { heading: '#ChromaLab', handle: '@chromalab', images: [{ image: '@h0' }, { image: '@p0' }, { image: '@h1' }, { image: '@p1' }] })],
  payments: 'Card, Wallets',
});

def({
  id: 'outdoor', name: 'Ridgeline Outfitters', niche: 'Outdoor gear', category: 'Fitness & sport', photos: 'outdoor', description: 'Rugged outdoor gear shop with field-tested story.',
  theme: { colors: { background: '#f3f1ea', surface: '#e3e0d2', text: '#1b261d', muted: '#66705f', primary: '#24402a', primaryText: '#f3f1ea', accent: '#e07a1f', border: '#d3cfbf' }, fonts: { heading: 'condensed', body: 'avenir' }, headingWeight: 800, headingCase: 'uppercase', radius: 12, buttons: 'pill', headerStyle: 'split', cardStyle: 'plain', headingScale: 'huge', tracking: 'normal' },
  art: ['#e5e2d6', '#e07a1f'], swatches: ['#2f4a33', '#e07a1f', '#4b5563', '#7c5e3c'], heroArt: 'tent',
  products: [['Summit 2P Tent', 349, 399, 'tent', 'Camp', null, { featured: true, ph: ['@p0', '@h1'], rating: 4.9, reviews: 128 }], ['Trailhead 30L Pack', 129, 0, 'backpack', 'Packs', { Color: ['Forest', 'Ember'] }, { ph: ['@p2', '@h0'], rating: 4.8, reviews: 207 }], ['Campfire Cook Set', 69, 0, 'cup', 'Camp', null, { ph: ['@p1', '@p0'], tags: ['new'] }], ['Guided Weekend Hike', 189, 0, 'boot', 'Trips', null, { ph: ['@h1', '@p2'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Field-tested gear', heading: 'Go further. Stay out longer.', text: 'Tents, packs and layers built for real weather.', buttonLabel: 'Shop gear', buttonLink: 'collection:all', overlay: 40, image: '@h0', height: 'full' }),
    S('features', { style: 'strip', columns: 3, items: [{ icon: 'shield', title: 'Lifetime repairs', text: 'We fix what breaks' }, { icon: 'leaf', title: '1% for the planet', text: 'Supporting public lands' }, { icon: 'truck', title: 'Free shipping', text: 'On orders over $99' }] }),
    S('collection-list', { heading: 'Gear up', columns: 4, style: 'tall' }),
    S('featured-products', { eyebrow: 'Trail favourites', heading: 'Built for the long way', columns: 4 }),
    S('image-text', { eyebrow: 'Our story', heading: 'Tested on the ridge', text: 'Every product spends a season with our guides before it reaches the shop.', buttonLabel: 'Read more', buttonLink: 'page:about', layout: 'full', image: '@h1' }),
    S('newsletter', { heading: 'Trail notes', text: 'Routes, gear tips and early access.', image: '@p1' })],
  payments: 'Card, Wallets',
});

def({
  id: 'candles', name: 'Wick & Hollow', niche: 'Candles & gifts', category: 'Hobbies & gifts', photos: 'decor', description: 'Moody candle and gift shop with scent options.',
  theme: { colors: { background: '#17130f', surface: '#241e18', text: '#f2e9dc', muted: '#b3a48f', primary: '#e8c39e', primaryText: '#17130f', accent: '#e8c39e', border: '#3a322a' }, fonts: { heading: 'display', body: 'avenir' }, headingWeight: 400, radius: 18, buttons: 'outline', density: 'airy', headerStyle: 'centered', imageRatio: 'portrait', headingScale: 'huge', tracking: 'tight', shadow: 'none' },
  art: ['#29241f', '#e8c39e'], swatches: ['#e8c39e', '#8d6e63', '#556b5d', '#c6a2a2'], heroArt: 'candle',
  products: [['Cedar & Smoke Candle', 34, 0, 'candle', 'Candles', { Size: ['200 g', '400 g'] }, { ph: ['@p1', '@p2'], rating: 4.9, reviews: 344 }], ['Fig Leaf Candle', 34, 0, 'candle', 'Candles', { Size: ['200 g', '400 g'] }, { ph: ['@p0', '@p1'], tags: ['new'] }], ['Amber Duo', 58, 0, 'candle', 'Gifts', null, { ph: ['@p2', '@p0'] }], ['Gift Box Trio', 89, 102, 'box', 'Gifts', null, { ph: ['@h0', '@p2'] }]],
  home: [S('hero', { layout: 'image', heading: 'Slow evenings, bottled', text: 'Hand-poured soy candles in small batches.', buttonLabel: 'Shop scents', buttonLink: 'collection:all', align: 'center', overlay: 40, image: '@h0', height: 'full' }),
    S('featured-products', { heading: 'Signature scents', columns: 4 }),
    S('rich-text', { eyebrow: 'Poured by hand', text: 'Natural soy wax, cotton wicks and fine fragrance oils. Fifty hours of slow, clean burn.', size: 'large' }),
    S('banner', { heading: 'The gift box', text: 'Three bestsellers, wrapped and ready to give.', buttonLabel: 'Shop gifts', buttonLink: 'collection:all', style: 'image', image: '@p1' }),
    S('testimonials', { items: Q(['The cedar candle fills the whole room.', 'Marie L.'], ['Gorgeous packaging, perfect gift.', 'Owen F.'], ['My third order already.', 'Zoe B.']) })],
  payments: 'Card, Wallets',
});

const photoSet = t => PHOTOS[t.photos] || PHOTOS.general;
const tokenRef = (set, tok) => {
  const m = /^@([hpu])(\d+)$/.exec(tok); if (!m) return tok;
  const list = (m[1] === 'h' ? set.hero : m[1] === 'u' ? set.people || set.hero : set.product) || set.product;
  return 'unsplash:' + list[+m[2] % list.length][0];
};
const resolveTokens = (v, set) => typeof v === 'string' ? tokenRef(set, v) : Array.isArray(v) ? v.map(x => resolveTokens(x, set)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveTokens(x, set)])) : v;

export const STORE_TEMPLATES = T.map(t => ({ id: t.id, name: t.name, niche: t.niche, category: t.category, description: t.description, swatch: [t.theme.colors.background, t.theme.colors.primary, t.theme.colors.accent], photo: 'unsplash:' + photoSet(t).hero[0][0] }));
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
  const set = photoSet(t), [abg, aac] = t.art, sw = t.swatches;
  const digital = ['Digital', 'Education', 'Services'].includes(t.category);
  const products = t.products.map(([title, price, compareAt, kind, category, options, extra = {}], i) => {
    const { ph, ...rest } = extra;
    const opts = options ? Object.entries(options).map(([name, values]) => ({ name, values })) : [];
    const stockFor = k => (i * 7 + k * 3) % 13 === 5 ? 0 : 5 + ((i * 13 + k * 5) % 20);
    const photos = (ph || ['@p' + i, '@p' + (i + 1)]).map(x => tokenRef(set, x)).filter((r, k, a) => a.indexOf(r) === k);
    const p = { id: uid('p'), title, slug: slugify(title), price, compareAt: compareAt || null, category, description: (DESC[t.category] || DESC.default)(title),
      images: photos, art: gen(kind, abg, sw[i % sw.length], aac, i + 1), options: opts, tags: [slugify(category)], featured: i < 4, status: 'active', rating: null, reviews: 0, ...rest };
    p.tags = [...new Set([slugify(category), ...(rest.tags || [])])];
    let combos = [[]]; for (const o of opts) combos = combos.flatMap(c => o.values.map(v => [...c, v]));
    p.variants = combos.map((c, k) => ({ id: uid('v'), options: c, price: null, sku: [slugify(title).toUpperCase().slice(0, 18), ...c.map(v => slugify(v).toUpperCase())].join('-'), stock: digital ? null : stockFor(k) }));
    // Price steps for size-like options (bigger = pricier)
    if (opts[0] && /size|weight|length|license|metal|plan|hours|format|memory/i.test(opts[0].name) && opts[0].values.length > 1 && !/^(XS|S|M|L|XL|\d\d)$/.test(opts[0].values[0])) {
      p.variants.forEach(v => { const idx = opts[0].values.indexOf(v.options[0]); if (idx > 0) v.price = Math.round(price * (1 + idx * (/license/i.test(opts[0].name) ? 0.7 : 0.35))); });
    }
    return p;
  });
  const cats = [...new Set(products.map(p => p.category))];
  const collections = cats.map(c => ({ id: uid('c'), title: c, slug: slugify(c), description: '', image: products.find(p => p.category === c)?.images[0] || null, rule: { type: 'category', value: c, productIds: [] } }));
  const fallbackArt = gen(t.heroArt, abg, sw[0], aac, 3, true);
  const home = t.home.map(s => {
    const st = resolveTokens(structuredClone(s.settings), set);
    if (s.type === 'hero' && !st.image && st.layout !== 'text') st.image = tokenRef(set, '@h0');
    if (s.type === 'image-text' && !st.image) st.image = tokenRef(set, '@h1');
    if (s.type === 'banner' && st.style === 'image' && !st.image) st.image = tokenRef(set, '@h0');
    if (s.type === 'gallery' && !(st.images || []).length) st.images = products.slice(0, 6).map(p => ({ image: p.images[0], caption: '' }));
    if (s.type === 'countdown' && !st.endsAt) st.endsAt = new Date(Date.now() + 5 * 864e5 + 7 * 36e5).toISOString().slice(0, 16);
    return { type: s.type, settings: st };
  });
  // in-page anchors used by hero buttons point to a section of the home page
  const homeSections = home.map(s => ({ id: uid('s'), ...s }));
  const anchor = { '#plans': 'pricing', '#curriculum': 'curriculum', '#newsletter': 'newsletter' };
  const fix = o => { for (const k of ['buttonLink', 'button2Link']) { const want = anchor[o[k]]; if (want) { const target = homeSections.find(x => x.type === want); o[k] = target ? '#' + target.id : 'collection:all'; } } };
  for (const s of homeSections) { fix(s.settings); (s.settings.slides || []).forEach(fix); }
  const [cur, loc] = t.currency || ['USD', 'en-US'];
  const mode = t.checkout || 'whatsapp';
  const email = 'hello@' + slugify(t.name).replace(/-/g, '') + '.example';
  const navCols = t.nav ? collections.filter(c => t.nav.includes(c.title)) : collections.slice(0, 3);
  const store = {
    kind: 'store', templateId: t.id, name: t.name, logo: { text: t.name, image: null, height: 32 }, theme: t.theme, currency: { code: cur, locale: loc }, fallbackArt,
    announcement: { enabled: !!t.announcement, text: t.announcement || 'Free shipping on your first order', link: 'collection:all', style: t.annStyle || 'static' },
    layout: { header: { type: 'header', settings: { sticky: true, transparent: true, showSearch: true, showWishlist: true } }, footer: { type: 'footer', settings: { text: t.description, newsletter: true, payments: t.payments || '' } } },
    pages: {
      home: homeSections,
      collection: [S('collection-main', { columns: products.length > 4 ? 3 : 4 })],
      product: [S('product-main', {}), S('related-products'), S('features', { style: 'strip', columns: 4, items: STRIP })],
      about: [S('page-title', { eyebrow: 'About', heading: `About ${t.name}`, text: '', image: tokenRef(set, '@h1') }),
        S('image-text', { image: tokenRef(set, '@h0'), eyebrow: 'Our story', heading: 'Small team, big care', text: `${t.name} started with a simple idea: ${t.description.charAt(0).toLowerCase() + t.description.slice(1)}\n\nWe are a small team who care about every detail, from the first sketch to the moment your order arrives.` }),
        S('features', { columns: 3, items: STRIP.slice(0, 3) })],
      contact: [S('page-title', { heading: 'Contact us', text: 'Questions about an order or a product? We are happy to help.' }), S('contact-form')],
      cart: [S('cart-main')], checkout: [S('checkout-main')],
    },
    products, collections,
    navigation: {
      main: t.nav ? [...navCols.map(c => ({ label: c.title, target: 'collection:' + c.id })), { label: 'Collection', target: 'collection:all' }, { label: 'About', target: 'page:about' }]
        : [{ label: 'Shop', target: 'collection:all' }, ...navCols.map(c => ({ label: c.title, target: 'collection:' + c.id })), { label: 'About', target: 'page:about' }, { label: 'Contact', target: 'page:contact' }],
      footer: [{ label: 'All products', target: 'collection:all' }, ...collections.slice(0, 3).map(c => ({ label: c.title, target: 'collection:' + c.id })), { label: 'About', target: 'page:about' }, { label: 'Cart', target: 'cart' }],
    },
    social: { instagram: 'https://instagram.com/', facebook: '', tiktok: 'https://tiktok.com/', youtube: '', x: '', pinterest: 'https://pinterest.com/' },
    contact: { email, phone: '+1 555 0100', address: '', hours: '' },
    checkout: { mode, phone: '15550100', email, paymentLinks: {}, shippingNote: digital ? '' : 'Shipping is calculated and confirmed with you after ordering.', note: '' },
    seo: { title: `${t.name} — ${t.niche}`, description: t.description },
  };
  return normalizeStore(store);
}
