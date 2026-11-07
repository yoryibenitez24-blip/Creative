// Store templates: 46 original, complete multi-page stores across niches. Product names and prices are generic
// samples. Images are curated Unsplash photos from src/store/photos.js ('unsplash:<id>' refs, hot-linked);
// every product and the store also carry procedural art (src/store/art.js) used as the offline fallback.
//
//   STORE_TEMPLATES: [{ id, name, niche, category, description, swatch: [bg, fg, accent], photo: 'unsplash:<id>' }]
//   createStore(templateId?) → a normalised store document ready for the builder
//   TEMPLATE_CATEGORIES: category filter values for the gallery

import { gen } from './art.js';
import { PHOTOS } from './photos.js';
import { normalizeStore, slugify, uid } from './model.js';
import { productBlocks } from './sections.js';

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

// ---------- fashion & apparel collection (round 3) + grocery quick commerce ----------
const UGC = (...xs) => S('ugc', { images: xs.map(([image, handle]) => ({ image, handle, link: 'collection:all' })) });

def({
  id: 'voidline', name: 'VOIDLINE', niche: 'Techwear / streetwear', category: 'Fashion', photos: 'fashion', reviews: true, pdp: 'stack', description: 'Dark techwear hoodie brand with a giant wordmark and numbered slide index.',
  theme: { colors: { background: '#0b0b0b', surface: '#161616', text: '#ecece6', muted: '#8f8f88', primary: '#ecece6', primaryText: '#0b0b0b', accent: '#ff5a1f', border: '#262626' }, fonts: { heading: 'condensed', body: 'inter' }, headingWeight: 900, headingCase: 'uppercase', radius: 0, buttons: 'sharp', density: 'compact', headerStyle: 'split', cardStyle: 'plain', imageRatio: 'portrait', headingScale: 'huge', tracking: 'normal', shadow: 'none' },
  art: ['#161616', '#ff5a1f'], swatches: ['#2a2a2a', '#ecece6', '#ff5a1f', '#5a5a55'], heroArt: 'hoodie',
  products: [['Shell Hoodie 01', 145, 0, 'hoodie', 'Hoodies', { Size: SIZES, Color: ['Grey', 'Black'] }, { ph: ['@p1', '@u2'], tags: ['new'] }], ['Cargo Overshirt', 160, 190, 'jacket', 'Outerwear', { Size: SML, Color: ['Sage', 'Black'] }, { ph: ['@p3', '@u4'] }],
    ['Heavy Logo Tee', 55, 0, 'tshirt', 'Tees', { Size: SIZES, Color: ['White', 'Black'] }, { ph: ['@p0', '@u0'] }], ['Utility Denim Jacket', 210, 0, 'jacket', 'Outerwear', { Size: SML }, { ph: ['@p5', '@u1'] }], ['Loopback Crewneck', 95, 0, 'hoodie', 'Hoodies', { Size: SIZES }, { ph: ['@p4', '@u3'] }], ['Knit Layer', 120, 0, 'jacket', 'Knitwear', { Size: SML }, { ph: ['@p2', '@u4'] }]],
  home: [S('hero', { layout: 'wordmark', wordmark: 'VOIDLINE', heading: 'Built for the city after dark', slides: [{ image: '@u2', heading: 'Built for the city after dark', text: 'Technical layers, heavy fleece, zero logos you did not ask for.', buttonLabel: 'Shop drop 04', buttonLink: 'collection:all' }, { image: '@u0', heading: 'Heavy tees', text: '300 gsm, boxy, garment dyed.', buttonLabel: 'Shop tees', buttonLink: 'collection:all' }, { image: '@u1', heading: 'Outerwear', text: 'Water-repellent, packable, quiet.', buttonLabel: 'Shop outerwear', buttonLink: 'collection:all' }], height: 'full', overlay: 35, autoplay: 6, background: '#0b0b0b', textColor: '#ecece6' }),
    S('marquee', { text: 'Drop 04 | Technical layers | Free returns | Ships worldwide', style: 'outline', speed: 30 }),
    S('product-carousel', { eyebrow: 'Drop 04', heading: 'New this drop' }),
    S('collection-list', { heading: 'Categories', columns: 4, style: 'tall' }),
    S('image-text', { eyebrow: 'Fabric lab', heading: 'Engineered, not decorated', text: 'Recycled nylon shells, brushed fleece and taped seams. Every piece is tested for a winter of commuting.', buttonLabel: 'Read the specs', buttonLink: 'page:about', layout: 'full', image: '@u1' }),
    UGC(['@u0', '@kai.nite'], ['@u2', '@m.vance'], ['@u1', '@lowkeylayers'], ['@u3', '@sora.w']),
    S('newsletter', { heading: 'Drop alerts', text: 'One message when a drop goes live. Nothing else.' })],
  announcement: 'Drop 04 live now | Free returns | Ships worldwide', annStyle: 'marquee', payments: 'Card, Wallets',
});

def({
  id: 'stride', name: 'Stride Lab', niche: 'Performance sneakers', category: 'Fashion', photos: 'sneakers', reviews: true, pdp: 'classic', description: 'Sports sneaker store: “Driven by comfort”, pill nav over the hero and avatar social proof.',
  theme: { colors: { background: '#f3f4f0', surface: '#e6e8e1', text: '#0e0f0c', muted: '#62655c', primary: '#0e0f0c', primaryText: '#e4ff3a', accent: '#c6e600', border: '#d9dcd2' }, fonts: { heading: 'condensed', body: 'inter' }, headingWeight: 900, headingCase: 'uppercase', radius: 24, buttons: 'pill', density: 'comfortable', headerStyle: 'pill', cardStyle: 'card', imageRatio: 'square', headingScale: 'huge', tracking: 'normal' },
  art: ['#e6e8e1', '#c6e600'], swatches: ['#0e0f0c', '#ffffff', '#c6e600', '#62655c'], heroArt: 'sneaker',
  products: [['Stride Runner 2', 159, 179, 'sneaker', 'Running', { Size: ['40', '41', '42', '43', '44', '45'], Color: ['Grey', 'Black'] }, { ph: ['@p3', '@p1'], tags: ['new'] }], ['Prism Trainer', 149, 0, 'sneaker', 'Training', { Size: ['40', '41', '42', '43', '44'], Color: ['Coral', 'Sky'] }, { ph: ['@p1', '@h1'] }],
    ['Court Clean', 119, 0, 'sneaker', 'Lifestyle', { Size: ['38', '39', '40', '41', '42', '43'] }, { ph: ['@p2', '@p0'] }], ['Dune Low', 139, 0, 'sneaker', 'Lifestyle', { Size: ['38', '39', '40', '41', '42'], Color: ['Sand'] }, { ph: ['@p0', '@h0'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'New · Stride Runner 2', heading: 'Driven by comfort', text: 'Responsive foam, breathable knit and a fit that disappears on the run.', buttonLabel: 'Shop running', buttonLink: 'collection:all', button2Label: 'Find your fit', button2Link: 'page:contact', image: '@p3', overlay: 30, height: 'full' }),
    S('social-proof', { text: 'Join 25,000+ runners who switched to Stride', rating: 4.8, avatars: [{ image: '@fashion:u0' }, { image: '@fashion:u1' }, { image: '@fashion:u2' }, { image: '@fashion:u3' }, { image: '@fashion:u4' }] }),
    S('collection-list', { heading: 'Shop by activity', columns: 3, style: 'tall' }),
    S('featured-products', { eyebrow: 'Best sellers', heading: 'Built to move', columns: 4 }),
    S('bento', { heading: 'Comfort, engineered', items: [{ image: '@h1', title: 'Cloudfoam midsole', text: '12% more energy return.', link: 'collection:all' }, { image: null, title: '30-day run trial', text: 'Run in them. Return them if they are not for you.', link: '' }, { image: '@p2', title: 'Recycled knit upper', text: 'Breathable and light.', link: '' }] }),
    S('testimonials', { heading: 'Runners say', items: Q(['Zero break-in time. Ran a half marathon in week one.', 'Ade O.', 'Marathoner', '@fashion:u1'], ['Light, springy and they look clean off the track.', 'Hanna L.', 'Trail runner', '@fashion:u3'], ['My knees thank me every morning.', 'Ravi P.', 'Commuter runner', '@fashion:u2']) }),
    S('newsletter', { heading: 'Run club', text: 'Training plans and early access to colourways.', image: '@h0' })],
  announcement: '30-day run trial | Free shipping over $75', payments: 'Card, Wallets', nav: ['Running', 'Training', 'Lifestyle'],
});

def({
  id: 'formfield', name: 'Form & Field', niche: 'Minimal product-first apparel', category: 'Fashion', photos: 'fashion', reviews: true, pdp: 'editorial', description: 'Editorial, product-first store: lots of white, Helvetica-style type and uppercase spec tables.',
  theme: { colors: { background: '#ffffff', surface: '#f4f4f2', text: '#111111', muted: '#77776f', primary: '#111111', primaryText: '#ffffff', accent: '#111111', border: '#e6e6e2' }, fonts: { heading: 'helvetica', body: 'helvetica' }, headingWeight: 500, headingCase: 'uppercase', radius: 0, buttons: 'sharp', density: 'airy', headerStyle: 'left', cardStyle: 'plain', imageRatio: 'portrait', headingScale: 'regular', tracking: 'wide', shadow: 'none' },
  art: ['#f4f4f2', '#111111'], swatches: ['#d8d8d2', '#111111', '#9fb29f'], heroArt: 'tshirt',
  products: [['Tee No. 1', 48, 0, 'tshirt', 'Tops', { Size: SIZES, Color: ['White', 'Black'] }, { ph: ['@p0', '@u0'] }], ['Overshirt No. 3', 140, 0, 'jacket', 'Shirts', { Size: SML, Color: ['Sage'] }, { ph: ['@p3', '@h2'] }], ['Sweatshirt No. 2', 95, 0, 'hoodie', 'Tops', { Size: SIZES }, { ph: ['@p4', '@u2'] }], ['Knit Poncho No. 5', 180, 0, 'jacket', 'Knitwear', null, { ph: ['@p2', '@u3'] }],
    ['Hoodie No. 4', 120, 0, 'hoodie', 'Tops', { Size: SIZES }, { ph: ['@p1', '@u1'] }], ['Jacket No. 6', 220, 260, 'jacket', 'Outerwear', { Size: SML }, { ph: ['@p5', '@u4'] }]],
  home: [S('featured-products', { heading: 'Collection 01', text: 'Six garments. Made to be worn every day for years.', columns: 3, limit: 6, buttonLabel: '' }),
    S('rich-text', { eyebrow: 'Principles', text: 'Fewer, better garments. Natural fibres. Transparent prices. Repairs for life.', size: 'large', align: 'left' }),
    S('image-text', { heading: 'Made in Porto', text: 'Cut and sewn in a family workshop. We visit every season.', image: '@h2', imageSide: 'right' }),
    S('newsletter', { heading: 'Notes', text: 'New garments, rarely.' })],
  payments: 'Card, Bank transfer',
});

def({
  id: 'noir', name: 'Maison Noir', niche: 'Luxury womenswear', category: 'Fashion', photos: 'fashion', reviews: true, pdp: 'editorial', description: 'Luxury womenswear: black and ivory, Didot display type, editorial product pages.',
  theme: { colors: { background: '#f6f1ea', surface: '#ece4d8', text: '#141210', muted: '#7d746a', primary: '#141210', primaryText: '#f6f1ea', accent: '#8c6b45', border: '#ddd3c5' }, fonts: { heading: 'display', body: 'avenir' }, headingWeight: 400, radius: 0, buttons: 'solid', density: 'airy', headerStyle: 'centered', imageRatio: 'portrait', headingScale: 'huge', tracking: 'tight', shadow: 'none' },
  art: ['#ece4d8', '#8c6b45'], swatches: ['#141210', '#d6c3ad', '#8c6b45'], heroArt: 'dress',
  products: [['Camel Wool Blazer', 690, 0, 'jacket', 'Tailoring', { Size: ['34', '36', '38', '40', '42'] }, { ph: ['@u4', '@p5'] }], ['Cashmere Poncho', 820, 0, 'jacket', 'Knitwear', { Color: ['Cream'] }, { ph: ['@p2', '@u3'] }], ['Silk Shirt', 390, 460, 'tshirt', 'Shirts', { Size: ['34', '36', '38', '40'], Color: ['Sage', 'White'] }, { ph: ['@p3', '@u0'] }], ['Ribbed Cotton Tee', 160, 0, 'tshirt', 'Essentials', { Size: SIZES }, { ph: ['@p0', '@u1'] }]],
  home: [S('hero', { layout: 'carousel', heading: 'The quiet season', slides: [{ image: '@u4', heading: 'The quiet season', text: 'Tailoring and cashmere for the cold months.', buttonLabel: 'Discover', buttonLink: 'collection:all' }, { image: '@u3', heading: 'Cashmere, simply', text: 'Grade-A cashmere, knitted in Scotland.', buttonLabel: 'Shop knitwear', buttonLink: 'collection:all' }], height: 'full', overlay: 20, autoplay: 7 }),
    S('rich-text', { eyebrow: 'Maison Noir', text: 'Clothes made slowly, in small numbers, by people we know by name.', size: 'large' }),
    S('featured-products', { heading: 'The edit', columns: 4, buttonLabel: 'View all' }),
    S('image-text', { eyebrow: 'Atelier', heading: 'Cut by hand in Paris', text: 'Every blazer takes eleven hours to make.', image: '@h2', layout: 'overlap' }),
    UGC(['@u4', '@claire.d'], ['@u3', '@ines.m'], ['@u0', '@alma'], ['@u1', '@noor.s']),
    S('newsletter', { heading: 'Private appointments', text: 'Book a fitting in the Paris atelier.' })],
  currency: ['EUR', 'fr-FR'], announcement: 'Complimentary alterations on every order', payments: 'Card, Bank transfer',
});

def({
  id: 'indigo', name: 'Indigo Union', niche: 'Denim', category: 'Fashion', photos: 'fashion', reviews: true, pdp: 'classic', description: 'Denim workshop store with fit guide, washes and heritage storytelling.',
  theme: { colors: { background: '#f4f1ea', surface: '#e7e2d6', text: '#141c2e', muted: '#5e6578', primary: '#1f3b73', primaryText: '#f4f1ea', accent: '#c2763a', border: '#d8d2c4' }, fonts: { heading: 'condensed', body: 'iowan' }, headingWeight: 800, headingCase: 'uppercase', radius: 6, buttons: 'solid', headerStyle: 'split', cardStyle: 'plain', imageRatio: 'portrait', headingScale: 'huge', tracking: 'normal' },
  art: ['#e7e2d6', '#c2763a'], swatches: ['#1f3b73', '#3b5a80', '#141c2e'], heroArt: 'jacket',
  products: [['Type III Denim Jacket', 180, 0, 'jacket', 'Jackets', { Size: SIZES, Color: ['Denim'] }, { ph: ['@p5', '@u1'] }], ['Selvedge Workshirt', 120, 140, 'tshirt', 'Shirts', { Size: SIZES, Color: ['Sage', 'White'] }, { ph: ['@p3', '@h2'] }], ['Loopwheel Sweat', 110, 0, 'hoodie', 'Sweats', { Size: SIZES }, { ph: ['@p4', '@u2'] }], ['Pocket Tee', 45, 0, 'tshirt', 'Tees', { Size: SIZES, Color: ['White', 'Navy'] }, { ph: ['@p0', '@u0'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Since 1998', heading: 'Raw denim, honest work', text: '14 oz selvedge, cut and chain-stitched in our own shop.', buttonLabel: 'Shop denim', buttonLink: 'collection:all', image: '@u1', overlay: 40, height: 'full' }),
    S('features', { style: 'strip', columns: 4, items: [{ icon: 'award', title: '14 oz selvedge', text: 'Woven on shuttle looms' }, { icon: 'refresh', title: 'Free repairs', text: 'For life' }, { icon: 'truck', title: 'Free hemming', text: 'Tell us your inseam' }, { icon: 'shield', title: 'Fit guarantee', text: 'Free exchanges' }] }),
    S('featured-products', { eyebrow: 'Workshop favourites', heading: 'Built to fade', columns: 4 }),
    S('image-text', { eyebrow: 'The workshop', heading: 'Every seam, chain-stitched', text: 'We still run the 1960s Union Special machines that give our hems their roping.', layout: 'full', image: '@h0' }),
    S('faq', { heading: 'Fit & care', items: [{ q: 'How should raw denim fit?', a: 'Snug at first — it relaxes about half a size.' }, { q: 'When should I wash them?', a: 'Wait six months for the best fades, then wash cold, inside out.' }] })],
  payments: 'Card, Wallets',
});

def({
  id: 'littleloom', name: 'Little Loom', niche: 'Kidswear', category: 'Fashion', photos: 'fashion', reviews: true, pdp: 'compact', description: 'Soft, playful kidswear in organic cotton with rounded type.',
  theme: { colors: { background: '#fffaf3', surface: '#fbeee0', text: '#2d2a4a', muted: '#7a7690', primary: '#ff7a59', primaryText: '#ffffff', accent: '#5aa9a0', border: '#f1e2cf' }, fonts: { heading: 'rounded', body: 'rounded' }, headingWeight: 900, radius: 28, buttons: 'pill', headerStyle: 'split', cardStyle: 'card', imageRatio: 'square', headingScale: 'large', tracking: 'tight' },
  art: ['#fbeee0', '#5aa9a0'], swatches: ['#ff7a59', '#5aa9a0', '#f5c84c'], heroArt: 'tshirt',
  products: [['Mini Organic Tee', 22, 0, 'tshirt', 'Tops', { Size: ['2Y', '4Y', '6Y', '8Y'], Color: ['White', 'Coral'] }, { ph: ['@p0', '@toys:p0'] }], ['Cosy Mini Hoodie', 38, 45, 'hoodie', 'Tops', { Size: ['2Y', '4Y', '6Y', '8Y'] }, { ph: ['@p1', '@toys:h0'] }], ['Weekend Sweatshirt', 34, 0, 'hoodie', 'Tops', { Size: ['2Y', '4Y', '6Y'] }, { ph: ['@p4', '@toys:p1'] }], ['Play Day Set', 49, 0, 'box', 'Sets', null, { ph: ['@toys:p0', '@p0'] }]],
  home: [S('hero', { layout: 'split', eyebrow: '100% organic cotton', heading: 'Made for climbing, jumping and naps', text: 'Soft, tough kidswear that keeps up — and gets handed down.', buttonLabel: 'Shop kids', buttonLink: 'collection:all', image: '@toys:h0', background: '#fbeee0' }),
    S('featured-products', { heading: 'Little favourites', columns: 4 }),
    S('features', { columns: 3, items: [{ icon: 'leaf', title: 'Organic cotton', text: 'GOTS certified, gentle on skin.' }, { icon: 'refresh', title: 'Grows with them', text: 'Roll-up cuffs add a size.' }, { icon: 'gift', title: 'Gift wrapping', text: 'Free, with a handwritten note.' }] }),
    S('testimonials', { items: Q(['Survives the washing machine every single week.', 'Jo T.', 'Parent'], ['So soft, my son refuses to wear anything else.', 'Mira K.', 'Parent'], ['Lovely gift packaging.', 'Sam B.', 'Grandparent']) }),
    S('newsletter', { heading: 'Little letters', text: '10% off your first order.' })],
  payments: 'Card, Wallets',
});

def({
  id: 'kinetic', name: 'Kinetic Studio', niche: 'Athleisure', category: 'Fashion', photos: 'fitness', reviews: true, pdp: 'stack', description: 'Athleisure label with bold photography, bento grid and stacked product galleries.',
  theme: { colors: { background: '#f7f6f2', surface: '#ebe9e2', text: '#16161a', muted: '#6c6b70', primary: '#16161a', primaryText: '#f7f6f2', accent: '#ff6a3d', border: '#dddbd3' }, fonts: { heading: 'inter', body: 'inter' }, headingWeight: 800, radius: 20, buttons: 'pill', headerStyle: 'split', cardStyle: 'plain', imageRatio: 'portrait', headingScale: 'huge', tracking: 'tight' },
  art: ['#ebe9e2', '#ff6a3d'], swatches: ['#16161a', '#ff6a3d', '#9fb29f'], heroArt: 'tshirt',
  products: [['Studio Track Set', 129, 149, 'jacket', 'Sets', { Size: SIZES, Color: ['Yellow', 'Black'] }, { ph: ['@fashion:h3', '@p2'] }], ['Lift Tee', 42, 0, 'tshirt', 'Tops', { Size: SIZES, Color: ['White', 'Black'] }, { ph: ['@fashion:p0', '@p0'] }], ['Flow Hoodie', 89, 0, 'hoodie', 'Tops', { Size: SIZES, Color: ['Grey'] }, { ph: ['@fashion:p1', '@p1'] }], ['Core Mat', 59, 0, 'band', 'Gear', null, { ph: ['@p2', '@h0'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Move collection', heading: 'Made for movement', text: 'Training layers you will wear long after the workout.', buttonLabel: 'Shop the collection', buttonLink: 'collection:all', image: '@fashion:h3', overlay: 25, height: 'full' }),
    S('marquee', { text: 'Sweat-wicking | Four-way stretch | Recycled fabrics | Free returns', style: 'accent', speed: 28 }),
    S('featured-products', { heading: 'Most loved', columns: 4 }),
    S('bento', { heading: 'Train, then go out', items: [{ image: '@h1', title: 'Strength', text: 'Layers that move with you.', link: 'collection:all' }, { image: '@p2', title: 'Recovery', text: 'Soft, stretchy, cosy.', link: 'collection:all' }, { image: '@fashion:u0', title: 'Street', text: 'Clean lines for after.', link: 'collection:all' }] }),
    UGC(['@fashion:h3', '@move.with.mia'], ['@p2', '@coreclub'], ['@fashion:u0', '@jess.lifts'], ['@h1', '@kinetic.crew']),
    S('newsletter', { heading: 'Join the studio', text: 'Workout plans and early access.' })],
  payments: 'Card, Wallets',
});

def({
  id: 'carryall', name: 'Carryall Co.', niche: 'Bags & accessories', category: 'Fashion', photos: 'fashion', reviews: true, pdp: 'classic', description: 'Bags and accessories with warm leather tones and image swatches.',
  theme: { colors: { background: '#faf6f0', surface: '#efe6da', text: '#2a1f17', muted: '#83725f', primary: '#2a1f17', primaryText: '#faf6f0', accent: '#b5652b', border: '#e4d8c8' }, fonts: { heading: 'iowan', body: 'avenir' }, headingWeight: 500, radius: 18, buttons: 'pill', headerStyle: 'split', imageRatio: 'square', headingScale: 'large', tracking: 'tight' },
  art: ['#efe6da', '#b5652b'], swatches: ['#2a1f17', '#b5652b', '#d6c3ad'], heroArt: 'bag',
  products: [['Market Shopper', 79, 0, 'bag', 'Bags', { Color: ['Red', 'Black'] }, { ph: ['@general:p0', '@outdoor:p2'] }], ['Trail Day Pack', 129, 149, 'backpack', 'Bags', { Color: ['Forest', 'Sand'] }, { ph: ['@outdoor:p2', '@general:p0'] }], ['Gold Chain Bracelet', 89, 0, 'necklace', 'Jewellery', { Metal: ['Gold', 'Rose gold'] }, { ph: ['@jewelry:p2', '@jewelry:p3'] }], ['Pendant Necklace', 119, 0, 'necklace', 'Jewellery', null, { ph: ['@jewelry:p1', '@jewelry:p0'] }]],
  home: [S('hero', { layout: 'split', eyebrow: 'Carry better', heading: 'Bags that go everywhere you do', text: 'Water-resistant canvas, vegetable-tanned leather, lifetime repairs.', buttonLabel: 'Shop bags', buttonLink: 'collection:all', image: '@outdoor:h0', background: '#efe6da' }),
    S('collection-list', { heading: 'Shop by category', columns: 2, style: 'wide' }),
    S('featured-products', { heading: 'Everyday carry', columns: 4 }),
    S('image-text', { eyebrow: 'Made to last', heading: 'Repairs for life', text: 'Send it back any time — we fix straps, zips and seams for free.', image: '@outdoor:h1', layout: 'overlap' }),
    S('newsletter', { heading: 'The carry list', text: 'New colours and restocks, first.' })],
  payments: 'Card, Wallets',
});

def({
  id: 'basket', name: 'Basket', niche: 'Grocery quick commerce', category: 'Food & drink', photos: 'restaurant', reviews: false, pdp: 'compact', description: 'Search-first grocery store with a delivery-time badge and compact product pages.',
  theme: { colors: { background: '#ffffff', surface: '#f1f6ef', text: '#132013', muted: '#5f6d5f', primary: '#118a3c', primaryText: '#ffffff', accent: '#ffb800', border: '#e2eadf' }, fonts: { heading: 'inter', body: 'inter' }, headingWeight: 800, radius: 18, buttons: 'pill', density: 'compact', headerStyle: 'search', cardStyle: 'card', imageRatio: 'square', headingScale: 'regular', tracking: 'tight' },
  art: ['#f1f6ef', '#ffb800'], swatches: ['#118a3c', '#ffb800', '#e2603a'], heroArt: 'bag',
  products: [['Sourdough Loaf', 5.5, 0, 'bread', 'Bakery', null, { ph: ['@bakery:p0', '@bakery:h1'] }], ['Butter Croissants (4)', 6.9, 0, 'croissant', 'Bakery', null, { ph: ['@bakery:p1', '@bakery:p2'] }], ['Salmon Poke Bowl', 11.5, 13, 'dish', 'Ready meals', null, { ph: ['@p2', '@p0'] }], ['Margherita Pizza', 8.9, 0, 'pizza', 'Ready meals', null, { ph: ['@p1', '@p0'] }],
    ['Espresso Beans 250 g', 9.5, 0, 'coffeebag', 'Pantry', null, { ph: ['@coffee:p0', '@coffee:p1'] }], ['Potted Cactus', 7, 0, 'plant', 'Home', null, { ph: ['@plants:p1', '@plants:p0'] }]],
  home: [S('hero', { layout: 'split', eyebrow: 'Delivery in 15 minutes', heading: 'Groceries, at the door before the kettle boils', text: 'Fresh bakery, ready meals and pantry staples from local suppliers.', buttonLabel: 'Start shopping', buttonLink: 'collection:all', image: '@bakery:h0', background: '#f1f6ef', height: 'small' }),
    S('collection-list', { heading: 'Aisles', columns: 4, style: 'square' }),
    S('featured-products', { heading: 'Popular right now', columns: 5, limit: 10 }),
    S('banner', { heading: 'Free delivery over $25', text: 'Every order, every day.', buttonLabel: 'Fill your basket', buttonLink: 'collection:all', style: 'solid' }),
    S('features', { style: 'strip', columns: 3, items: [{ icon: 'bolt', title: '15-minute delivery', text: '7am – 11pm, every day' }, { icon: 'leaf', title: 'Local suppliers', text: 'Bread baked this morning' }, { icon: 'refresh', title: 'Freshness promise', text: 'Not perfect? Full refund' }] })],
  checkout: 'whatsapp', freeShipping: 25, badge: 'Delivery in 15 min', payments: 'Card, Cash',
});

// ---------- creative templates: built from the creative sections (editorial hero, rail, polaroids, steps, spec list, drops, stickers) ----------
const STEPS_SHOP = [{ icon: 'search', title: 'Pick your piece', text: 'Browse the drop and find your favourite.' }, { icon: 'ruler', title: 'Choose your fit', text: 'Our size guide takes a minute.' }, { icon: 'bag', title: 'Tap to order', text: 'Checkout in under a minute.' }, { icon: 'box', title: 'Unbox', text: 'Plastic-free, ready to gift.' }, { icon: 'heart', title: 'Wear on repeat', text: 'Built for years, not seasons.' }];

def({
  id: 'rail', name: 'Rail Studio', niche: 'Minimal studio wear', category: 'Fashion', photos: 'fashion', reviews: true, pdp: 'editorial', creative: true,
  description: 'Warm off-white studio label: grotesk headline with a blue dot, small uppercase meta labels and a clothes rail you slide.',
  theme: { colors: { background: '#f2eee6', surface: '#e7e1d6', text: '#151515', muted: '#6c675f', primary: '#151515', primaryText: '#f2eee6', accent: '#2a55ff', border: '#dcd5c8' }, fonts: { heading: 'spacegrotesk', body: 'inter', accent: 'instrument' }, headingWeight: 600, headingCase: 'none', radius: 14, buttons: 'pill', density: 'comfortable', headerStyle: 'left', cardStyle: 'plain', imageRatio: 'portrait', headingScale: 'large', tracking: 'tight', shadow: 'soft' },
  art: ['#e7e1d6', '#2a55ff'], swatches: ['#151515', '#f2eee6', '#2a55ff', '#9a8f80'], heroArt: 'tshirt',
  products: [['Studio Tank', 45, 0, 'tshirt', 'Tops', { Size: SIZES, Color: ['Black', 'Off-white'] }, { ph: ['@p0', '@u0'], tags: ['new'], rating: 4.8, reviews: 64 }], ['Work Shirt', 98, 0, 'jacket', 'Shirts', { Size: SML, Color: ['Sage', 'Bone'] }, { ph: ['@p3', '@h2'], rating: 4.9, reviews: 41 }],
    ['Loop Hoodie', 120, 0, 'hoodie', 'Tops', { Size: SIZES, Color: ['Grey', 'Black'] }, { ph: ['@p1', '@u2'] }], ['Knit Poncho', 160, 0, 'jacket', 'Knitwear', { Color: ['Cream', 'Oat'] }, { ph: ['@p2', '@u3'] }], ['Studio Sweat', 88, 0, 'hoodie', 'Tops', { Size: SIZES, Color: ['White', 'Grey'] }, { ph: ['@p4', '@u1'] }], ['Field Jacket', 210, 240, 'jacket', 'Outerwear', { Size: SML, Color: ['Denim'] }, { ph: ['@p5', '@u4'] }]],
  home: [S('editorial-hero', { layout: 'split', metaLeft: 'Capsule 001 / Rail Studio', metaRight: '06 objects / one creative spirit', heading: 'Made for making', dot: true, text: 'Studio wear for people who make things. Heavy cotton, honest cuts, built to get paint on.', buttonLabel: 'Shop the capsule', buttonLink: '#rail', button2Label: 'The studio', button2Link: 'page:about', image: '@h2', image2: '@p0', caption: 'Studio Tank — off-white', sticker: 'Capsule 001 · Made in small runs' }),
    S('rail', { eyebrow: 'Capsule 001 / Rail Studio', heading: 'On the rail', metaRight: '06 objects / one creative spirit', source: 'all', limit: 6 }),
    S('marquee', { text: 'Made in small runs | Free repairs for life | Ships in 48 hours | Carbon-neutral delivery', style: 'ticker', separator: '●', speed: 40 }),
    S('split-feature', { eyebrow: 'The studio', heading: 'Built for the *studio floor*', text: 'Every piece is tested in our own workshop for a season before it goes on the rail.', image: '@u3', shape: 'arch', imageSide: 'left', background: '#151515', textColor: '#f2eee6', items: [{ icon: 'leaf', title: '400 gsm organic cotton', text: 'Dense, soft and breathable.' }, { icon: 'refresh', title: 'Repairs for life', text: 'Send it back, we fix it free.' }, { icon: 'award', title: 'Reinforced seams', text: 'Bar-tacked where it matters.' }] }),
    S('spec-list', { eyebrow: '01 Studio Tank', heading: 'The *details*', rows: 'Fabric | 100% organic cotton rib\nWeight | 240 gsm\nFit | Relaxed, long body\nColours | Black / Off-white\nMade in | Porto, Portugal', image: '@p0', imageSide: 'right', buttonLabel: 'Shop the tank', buttonLink: 'collection:all' }),
    S('polaroids', { heading: 'One capsule. *Three ways.*', items: [{ image: '@u0', caption: 'Studio', note: 'Under an apron', link: '' }, { image: '@u1', caption: 'Street', note: 'Layered under denim', link: '' }, { image: '@u2', caption: 'Sunday', note: 'With everything', link: '' }] }),
    S('newsletter', { heading: 'Capsule notes', text: 'One email when a new capsule lands on the rail.' })],
  productSections: [S('spec-list', { eyebrow: 'Studio standard', heading: 'Made *properly*', rows: 'Fabric | Organic cotton, OEKO-TEX\nStitching | Double needle, bar-tacked\nRepairs | Free for life\nPackaging | Recycled paper', image: null })],
  footer: { text: 'Studio wear for people who make things. Small runs, honest cuts, repairs for life.', wordmark: true }, announcement: 'Capsule 001 is live | Free repairs for life', payments: 'Card, Wallets',
});

def({
  id: 'checkmate', name: 'Checkmate', niche: 'Playful shirt label', category: 'Fashion', photos: 'shirts', reviews: true, pdp: 'classic', creative: true,
  description: 'Long, playful landing page in acid lime, lilac and forest: sticker badge, tilted ticker, polaroid collage, timeline and a live drop countdown.',
  theme: { colors: { background: '#fbfaf3', surface: '#eef2da', text: '#14251b', muted: '#56665b', primary: '#17402d', primaryText: '#d4f25a', accent: '#9b6cf0', border: '#dfe5c6' }, fonts: { heading: 'anton', body: 'manrope', accent: 'instrument' }, headingWeight: 400, headingCase: 'uppercase', radius: 22, buttons: 'pill', density: 'comfortable', headerStyle: 'pill', cardStyle: 'tagged', imageRatio: 'portrait', headingScale: 'huge', tracking: 'normal', shadow: 'soft' },
  art: ['#eef2da', '#9b6cf0'], swatches: ['#d4f25a', '#c9a7f5', '#17402d', '#fbfaf3'], heroArt: 'tshirt',
  products: [['Chambray Dot Shirt', 59, 0, 'jacket', 'Shirts', { Size: SIZES, Color: ['Denim', 'White'] }, { ph: ['@p0', '@u0'], tags: ['new'], rating: 4.8, reviews: 126 }], ['Sunday Oxford', 65, 0, 'jacket', 'Shirts', { Size: SIZES, Color: ['White', 'Sky'] }, { ph: ['@p1', '@u1'], rating: 4.9, reviews: 212 }],
    ['Dip-Dye Camp Shirt', 72, 89, 'jacket', 'Shirts', { Size: SML, Color: ['Lilac', 'Coral', 'Blue'] }, { ph: ['@p2', '@h0'], tags: ['new'], rating: 4.7, reviews: 58 }], ['Bow Blouse', 78, 0, 'dress', 'Blouses', { Size: SIZES, Color: ['White'] }, { ph: ['@p3', '@u3'], rating: 4.9, reviews: 77 }],
    ['Sky Oxford', 65, 0, 'jacket', 'Shirts', { Size: SIZES, Color: ['Sky', 'Lilac'] }, { ph: ['@p4', '@u2'], rating: 4.8, reviews: 94 }], ['Windowpane Check Blazer', 189, 220, 'jacket', 'Tailoring', { Size: SML, Color: ['Forest', 'Sand'] }, { ph: ['@p5', '@h1'], tags: ['new'], rating: 5, reviews: 31 }]],
  home: [S('editorial-hero', { layout: 'collage', metaLeft: 'Fashion · 2026 · Shirts', metaRight: 'Drop 02 — out now', heading: 'Shirts that speak *before you do.*', dot: false, text: 'Crisp cottons, loud colour and checks with an opinion. Cut to mix, made to be noticed.', buttonLabel: 'Shop the drop', buttonLink: 'collection:all', button2Label: 'Find your fit', button2Link: '#steps', image: '@h0', image2: '@p5', caption: 'mood 01', sticker: 'Fashion · 2026 · Shirts', background: '#d4f25a', textColor: '#14251b' }),
    S('marquee', { text: 'New drop | Soft cotton | Free exchanges | Made to mix | Loud on purpose', style: 'solid', separator: '★', tilt: true, background: '#17402d', textColor: '#d4f25a', speed: 34 }),
    S('featured-products', { eyebrow: 'The line-up', heading: 'Pick your *mood*', columns: 3, limit: 6, buttonLabel: 'Shop all shirts' }),
    S('split-feature', { eyebrow: 'Why they feel different', heading: 'Easy on you, *loud on the street*', text: 'Brushed long-staple cotton that softens with every wash, in colours that refuse to fade into the background.', image: '@u2', shape: 'tilt', imageSide: 'right', background: '#c9a7f5', textColor: '#14251b', sticker: 'Soft · Breathable · Bold', items: [{ icon: 'leaf', title: 'Breathable cotton', text: 'Long-staple, brushed for softness.' }, { icon: 'refresh', title: 'Free exchanges', text: 'Wrong size? Swap it in two taps.' }, { icon: 'heart', title: 'Cut to move', text: 'Room in the shoulders, never boxy.' }] }),
    S('polaroids', { eyebrow: 'Style it', heading: 'One check. *Three moods.*', items: [{ image: '@p5', caption: 'Office mode', note: 'Blazer, tucked shirt, loafers', link: 'collection:all' }, { image: '@u0', caption: 'Weekend', note: 'Open over a tee', link: 'collection:all' }, { image: '@u2', caption: 'After dark', note: 'Buttoned to the top', link: 'collection:all' }] }),
    S('spec-list', { eyebrow: 'Fabric file', heading: 'Soft enough to *live in*', rows: 'Cotton | 100% long-staple, brushed\nWeight | 140 gsm poplin\nCollar | Soft camp or button-down\nFit | Relaxed, true to size\nCare | 30° wash, no ironing drama', image: '@p1', imageSide: 'left', background: '#eef2da' }),
    S('testimonials', { style: 'big', eyebrow: 'Reviews', heading: 'Loved *loudly*', rating: '4.9', ratingText: 'Average from 2,300+ reviews', items: Q(['The colours are even better in real life. I get stopped on the street.', 'Nia O.', 'Bought 3 shirts', '@u3'], ['Softest shirt I own. It survived a festival and still looks new.', 'Theo B.', 'Sunday Oxford', '@u0'], ['Sized up for the oversized look — perfect.', 'Mara S.', 'Dip-Dye Camp Shirt', '@u2'], ['Fast delivery and the packaging made me smile.', 'Jules K.', 'Bow Blouse', '@u1']) }),
    S('steps', { eyebrow: 'How it works', heading: 'From cart to *wardrobe*', style: 'line', items: STEPS_SHOP }),
    S('drop-countdown', { eyebrow: 'Limited check collection 02', heading: 'The check drop *lands soon*', text: '300 pieces. Four checks. When they are gone, they are gone.', buttonLabel: 'Get early access', buttonLink: '#newsletter', image: '@p2', sticker: 'Limited · Drop 02 · 300 pieces', background: '#17402d', textColor: '#d4f25a' }),
    S('newsletter', { heading: 'Get the drop first', text: 'Early access, styling notes and zero spam.' })],
  productSections: [S('steps', { heading: 'Ordering is *easy*', style: 'cards', items: STEPS_SHOP.slice(1, 5) })],
  footer: { text: 'Loud shirts, soft cotton. Designed to mix, made to be noticed.', dark: true, wordmark: true }, announcement: 'Drop 02 is live | Free exchanges | Ships in 48 h', annStyle: 'marquee', payments: 'Card, Wallets', nav: ['Shirts', 'Blouses', 'Tailoring'],
});

def({
  id: 'cutout', name: 'Cutout Press', niche: 'Brutalist streetwear zine', category: 'Fashion', photos: 'fashion', reviews: true, pdp: 'stack', creative: true,
  description: 'Photocopied-zine streetwear store: paper background, heavy black type, mono body, red tilted ticker and taped polaroids.',
  theme: { colors: { background: '#efeee8', surface: '#e2e0d6', text: '#0d0d0d', muted: '#4f4f4a', primary: '#0d0d0d', primaryText: '#efeee8', accent: '#ff3d14', border: '#0d0d0d' }, fonts: { heading: 'archivo', body: 'spacemono', accent: 'dmserif' }, headingWeight: 400, headingCase: 'uppercase', radius: 0, buttons: 'sharp', density: 'compact', headerStyle: 'split', cardStyle: 'bordered', imageRatio: 'portrait', headingScale: 'huge', tracking: 'tight', shadow: 'none' },
  art: ['#e2e0d6', '#ff3d14'], swatches: ['#0d0d0d', '#efeee8', '#ff3d14', '#8a8a82'], heroArt: 'hoodie',
  products: [['Xerox Tee', 38, 0, 'tshirt', 'Tees', { Size: SIZES, Color: ['White', 'Black'] }, { ph: ['@p0', '@u0'], tags: ['new'] }], ['Cut & Paste Hoodie', 92, 0, 'hoodie', 'Hoodies', { Size: SIZES, Color: ['Grey', 'Black'] }, { ph: ['@p1', '@u2'] }],
    ['Staple Overshirt', 110, 0, 'jacket', 'Outerwear', { Size: SML }, { ph: ['@p3', '@u4'] }], ['Halftone Knit', 125, 0, 'jacket', 'Knitwear', null, { ph: ['@p2', '@u3'] }], ['Photocopy Crew', 75, 0, 'hoodie', 'Hoodies', { Size: SIZES }, { ph: ['@p4', '@u1'] }], ['Fold-Out Denim', 168, 195, 'jacket', 'Outerwear', { Size: SML }, { ph: ['@p5', '@u4'] }]],
  home: [S('editorial-hero', { layout: 'stack', metaLeft: 'Issue 09 — Spring / Summer', metaRight: 'Printed in small runs', heading: 'Cut. Paste. *Repeat.*', dot: false, text: 'Streetwear published like a zine: six garments, one issue, no reprints.', buttonLabel: 'Read issue 09', buttonLink: 'collection:all', image: '@h3', sticker: 'Issue 09 · Free zine inside' }),
    S('marquee', { text: 'Issue 09 | No reprints | Free zine with every order | Worldwide shipping', style: 'solid', separator: '/', tilt: true, background: '#ff3d14', textColor: '#0d0d0d', speed: 28 }),
    S('featured-products', { eyebrow: 'Contents', heading: 'In this *issue*', columns: 3, limit: 6, buttonLabel: 'All pages' }),
    S('polaroids', { eyebrow: 'Readers', heading: 'Seen in the *wild*', items: [{ image: '@u0', caption: 'p. 04', note: '@kai.nite' }, { image: '@u2', caption: 'p. 11', note: '@m.vance' }, { image: '@u1', caption: 'p. 17', note: '@lowkeylayers' }, { image: '@u3', caption: 'p. 22', note: '@sora.w' }] }),
    S('spec-list', { eyebrow: 'Colophon', heading: 'Printing *notes*', rows: 'Print run | 300 per style\nPaper stock | 280 gsm heavyweight cotton\nInk | Water-based, cracks beautifully\nBinding | Flatlock seams\nReprints | Never' }),
    S('drop-countdown', { eyebrow: 'Next issue', heading: 'Issue 10 *goes to print*', text: 'Subscribers get the link an hour early.', buttonLabel: 'Subscribe', buttonLink: '#newsletter', image: '@u4', sticker: 'Issue 10 · Coming soon', background: '#0d0d0d', textColor: '#efeee8' }),
    S('newsletter', { heading: 'Subscribe to the issue', text: 'One email per print run.' })],
  footer: { text: 'Streetwear published like a zine. One issue at a time, never reprinted.', wordmark: true }, announcement: 'Issue 09 out now | Free zine with every order', annStyle: 'marquee', payments: 'Card, Wallets',
});

def({
  id: 'hyperglow', name: 'Hyperglow', niche: 'Y2K beauty', category: 'Beauty', photos: 'beauty', reviews: true, pdp: 'classic', creative: true,
  description: 'Y2K chrome beauty brand: glowing gradient hero, bubbly display type, organic blob photos and a holo restock countdown.',
  theme: { colors: { background: '#f3f0ff', surface: '#e7e1ff', text: '#1b1430', muted: '#675e8c', primary: '#1b1430', primaryText: '#f3f0ff', accent: '#ff4fd8', border: '#dcd4fa' }, fonts: { heading: 'unbounded', body: 'manrope', accent: 'instrument' }, headingWeight: 700, headingCase: 'none', radius: 28, buttons: 'pill', density: 'comfortable', headerStyle: 'pill', cardStyle: 'tagged', imageRatio: 'portrait', headingScale: 'large', tracking: 'tight', shadow: 'soft' },
  art: ['#e7e1ff', '#ff4fd8'], swatches: ['#ff4fd8', '#9db4ff', '#1b1430', '#d6ccff'], heroArt: 'serum',
  products: [['Liquid Chrome Serum', 38, 0, 'serum', 'Serums', { Size: ['30 ml', '50 ml'] }, { ph: ['@p2', '@p3'], tags: ['new'], rating: 4.9, reviews: 318 }], ['Afterglow Drops', 42, 0, 'serum', 'Serums', null, { ph: ['@p3', '@p2'], rating: 4.8, reviews: 204 }],
    ['Holo Eye Palette', 34, 0, 'palette', 'Colour', { Finish: ['Holo', 'Matte'] }, { ph: ['@p4', '@p1'], tags: ['new'], rating: 4.7, reviews: 96 }], ['Cloud Cream', 29, 0, 'jar', 'Skincare', null, { ph: ['@p0', '@h1'], rating: 4.8, reviews: 151 }],
    ['Soft Focus Brush Set', 45, 0, 'lipstick', 'Tools', null, { ph: ['@p1', '@h0'], rating: 4.6, reviews: 63 }], ['Glass Skin Duo', 72, 80, 'serum', 'Sets', null, { ph: ['@p2', '@p0'], rating: 4.9, reviews: 88 }]],
  home: [S('hero', { layout: 'gradient', eyebrow: 'Glow lab · Est. 2026', heading: 'Skin, but make it *chrome*', text: 'High-shine serums and holo colour, vegan and refillable.', buttonLabel: 'Shop the glow', buttonLink: 'collection:all', button2Label: 'Our science', button2Link: 'page:about', image: '@p2', background: '#1b1430', textColor: '#f3f0ff', sticker: 'Glow · 2026 · Serums', height: 'large' }),
    S('marquee', { text: 'Vegan | Cruelty-free | Dermatologist tested | Refillable glass | Fragrance-free', style: 'ticker', separator: '✦', background: '#ff4fd8', textColor: '#1b1430', speed: 36 }),
    S('featured-products', { eyebrow: 'Cult favourites', heading: 'Shine *on repeat*', columns: 3, limit: 6 }),
    S('split-feature', { eyebrow: 'The science', heading: 'Serums with *serious* science', text: 'Peptides, niacinamide and squalane in concentrations that actually do something.', image: '@p3', shape: 'blob', background: '#1b1430', textColor: '#f3f0ff', imageSide: 'left', items: [{ icon: 'sparkle', title: 'Glass-skin finish', text: 'Visible glow in 7 days.' }, { icon: 'leaf', title: '100% vegan', text: 'No animal anything.' }, { icon: 'shield', title: 'Barrier-safe', text: 'Tested on sensitive skin.' }] }),
    S('steps', { eyebrow: 'Routine', heading: 'Your 3-step *glow*', style: 'cards', items: [{ icon: 'refresh', title: 'Cleanse', text: 'Start with a soft, fresh base.' }, { icon: 'sparkle', title: 'Serum', text: 'Two drops of Liquid Chrome.' }, { icon: 'heart', title: 'Seal', text: 'Cloud Cream locks it in.' }] }),
    S('testimonials', { style: 'big', heading: 'Glowing *reviews*', rating: '4.8', ratingText: 'From 5,000+ glow-getters', items: Q(['My skin literally looks like glass. Obsessed.', 'Ama D.', 'Liquid Chrome Serum', '@fashion:u0'], ['The palette is unreal — holo on the lid, wearable at work.', 'Lena V.', 'Holo Eye Palette', '@fashion:u3']) }),
    S('drop-countdown', { eyebrow: 'Restock alert', heading: 'Holo palette *restock*', text: 'It sold out in four hours last time. Set a reminder.', buttonLabel: 'Notify me', buttonLink: '#newsletter', image: '@p4', sticker: 'Restock · Holo · Limited', background: '#ff4fd8', textColor: '#1b1430' }),
    S('newsletter', { heading: 'Join the glow list', text: 'Restocks, routines and member-only shades.' })],
  footer: { text: 'High-shine skincare and holo colour. Vegan, refillable, a little bit extra.', dark: true }, announcement: 'Free shipping over $40 | Refills save 20%', payments: 'Card, Wallets',
});

def({
  id: 'raster', name: 'Raster Objects', niche: 'Design objects', category: 'Home & living', photos: 'objects', reviews: true, pdp: 'editorial', creative: true,
  description: 'Swiss-grid design objects shop: white space, Helvetica, a red ticker, indexed products and spec lists.',
  theme: { colors: { background: '#ffffff', surface: '#f0f0ee', text: '#0a0a0a', muted: '#6b6b6b', primary: '#0a0a0a', primaryText: '#ffffff', accent: '#ff3300', border: '#d9d9d6' }, fonts: { heading: 'helvetica', body: 'helvetica', accent: 'helvetica' }, headingWeight: 700, headingCase: 'none', radius: 0, buttons: 'sharp', density: 'comfortable', headerStyle: 'left', cardStyle: 'plain', imageRatio: 'square', headingScale: 'huge', tracking: 'tight', shadow: 'none' },
  art: ['#f0f0ee', '#ff3300'], swatches: ['#0a0a0a', '#ff3300', '#9a9a96', '#2a6f73'], heroArt: 'lamp',
  products: [['Floor Lamp No. 1', 340, 0, 'lamp', 'Lighting', { Color: ['Grey', 'Black'] }, { ph: ['@p0', '@p2'], rating: 4.9, reviews: 38 }], ['Pendant No. 2', 190, 0, 'lamp', 'Lighting', { Color: ['White', 'Teal'] }, { ph: ['@p1', '@h1'], tags: ['new'], rating: 4.8, reviews: 22 }],
    ['Reading Lamp No. 3', 260, 0, 'lamp', 'Lighting', null, { ph: ['@p2', '@p0'] }], ['Stool No. 4', 140, 0, 'chair', 'Seating', { Finish: ['Ash', 'Oak'] }, { ph: ['@p3', '@p4'] }], ['Shell Chair No. 5', 290, 330, 'chair', 'Seating', { Color: ['Black', 'White'] }, { ph: ['@p4', '@p3'] }], ['Pendant Cluster No. 6', 480, 0, 'lamp', 'Lighting', null, { ph: ['@p5', '@h0'] }]],
  home: [S('editorial-hero', { layout: 'split', metaLeft: 'Index 01 — Objects for daily use', metaRight: 'Zürich / Berlin', heading: 'Form follows function', dot: true, text: 'Six objects, designed on a grid and built to last decades. Nothing added that does not need to be there.', buttonLabel: 'View the index', buttonLink: '#rail', image: '@h1', image2: '@p3', caption: 'No. 2 Pendant' }),
    S('marquee', { text: 'Index 01 | 6 objects | Designed to last decades | Free delivery in the EU', style: 'ticker', separator: '/', background: '#ff3300', textColor: '#ffffff', speed: 44 }),
    S('rail', { eyebrow: 'Index 01', heading: 'The collection', metaRight: '06 objects / one grid', source: 'all', limit: 6 }),
    S('spec-list', { eyebrow: 'No. 1', heading: 'Floor Lamp No. 1', text: 'Powder-coated steel, a counterweighted arm and one switch.', rows: 'Height | 152 cm\nShade | Ø 32 cm, steel\nLight | E27, max 60 W\nCable | 2.5 m textile\nWarranty | 10 years', image: '@p0', imageSide: 'left', buttonLabel: 'Shop No. 1', buttonLink: 'collection:all' }),
    S('steps', { eyebrow: 'Process', heading: 'Ordered to last', style: 'line', items: [{ icon: 'card', title: 'Order', text: 'Pay securely online.' }, { icon: 'box', title: 'Built to order', text: 'In our Berlin workshop.' }, { icon: 'truck', title: 'Delivered', text: 'Within 3 weeks.' }, { icon: 'refresh', title: 'Parts for life', text: 'Every part replaceable.' }] }),
    S('rich-text', { eyebrow: 'Principle', text: 'Less, but better. Every object in the index is designed to be repaired, not replaced.', size: 'large', align: 'left' }),
    S('newsletter', { heading: 'Index updates', text: 'A new object, twice a year.' })],
  currency: ['EUR', 'de-DE'], footer: { text: 'Objects for daily use, designed on a grid and built to last decades.', wordmark: true }, payments: 'Card, Bank transfer',
});

def({
  id: 'kiln', name: 'Kiln & Clay', niche: 'Handmade ceramics', category: 'Home & living', photos: 'ceramics', reviews: true, pdp: 'classic', creative: true,
  description: 'Warm handmade ceramics studio: terracotta palette, soft serif type, organic blob and arch photo shapes, studio polaroids.',
  theme: { colors: { background: '#f4ece2', surface: '#ebdcc9', text: '#3a2418', muted: '#85695a', primary: '#b5532f', primaryText: '#fff7ef', accent: '#6f8a5b', border: '#e0cdb8' }, fonts: { heading: 'fraunces', body: 'manrope', accent: 'fraunces' }, headingWeight: 500, headingCase: 'none', radius: 24, buttons: 'pill', density: 'airy', headerStyle: 'centered', cardStyle: 'card', imageRatio: 'portrait', headingScale: 'large', tracking: 'tight', shadow: 'soft' },
  art: ['#ebdcc9', '#b5532f'], swatches: ['#b5532f', '#6f8a5b', '#e8d7c0', '#3a2418'], heroArt: 'vase',
  products: [['Speckled Cup Set', 48, 0, 'cup', 'Tableware', { Glaze: ['Oat', 'Honey'] }, { ph: ['@p0', '@h0'], tags: ['new'], rating: 4.9, reviews: 57 }], ['Lagoon Plate Set', 86, 0, 'dish', 'Tableware', { Size: ['Set of 2', 'Set of 4'] }, { ph: ['@p1', '@h1'], rating: 4.8, reviews: 33 }],
    ['Bottle Vase Pair', 64, 0, 'vase', 'Vases', null, { ph: ['@p2', '@p0'], rating: 4.9, reviews: 21 }], ['Mint Planter', 32, 0, 'vase', 'Vases', null, { ph: ['@decor:p3', '@p2'] }], ['Wheel Class for Two', 140, 0, 'ticket', 'Classes', { Date: ['Saturday', 'Sunday'] }, { ph: ['@p3', '@h0'] }], ['Seconds Box', 45, 70, 'box', 'Tableware', null, { ph: ['@h1', '@p0'] }]],
  home: [S('editorial-hero', { layout: 'split', shape: 'blob', metaLeft: 'Studio pottery — batch 14', metaRight: 'Each piece one of a kind', heading: 'Made slowly, *by hand*', dot: false, text: 'Wheel-thrown stoneware for everyday rituals, glazed in small batches in our Lisbon studio.', buttonLabel: 'Shop batch 14', buttonLink: 'collection:all', button2Label: 'Book a class', button2Link: 'collection:all', image: '@h0', image2: '@p0', sticker: 'Handmade · Batch 14 · Small run' }),
    S('marquee', { text: 'Wheel-thrown | Food safe | Dishwasher friendly | Made in Lisbon', style: 'ticker', separator: '✺', background: '#3a2418', textColor: '#f4ece2', speed: 42 }),
    S('featured-products', { eyebrow: 'Batch 14', heading: 'Fresh from the *kiln*', columns: 3, limit: 6 }),
    S('split-feature', { eyebrow: 'Our glazes', heading: 'Glazes mixed *in-house*', text: 'Every colour is developed from raw minerals in the studio, so no two firings are ever quite the same.', image: '@p2', shape: 'blob', background: '#6f8a5b', textColor: '#f7f1e8', items: [{ icon: 'leaf', title: 'Lead-free & food safe', text: 'Tested every batch.' }, { icon: 'sparkle', title: 'Unique variations', text: 'Speckles, drips and all.' }, { icon: 'gift', title: 'Wrapped by hand', text: 'Ready to give.' }] }),
    S('polaroids', { eyebrow: 'Inside the studio', heading: 'Mud, fire *and patience*', items: [{ image: '@h0', caption: 'Throwing', note: 'Day one' }, { image: '@p1', caption: 'Glazing', note: 'Day six' }, { image: '@p2', caption: 'Opening the kiln', note: 'Day nine' }] }),
    S('steps', { eyebrow: 'Process', heading: 'How a cup is *made*', style: 'cards', items: [{ icon: 'heart', title: 'Throw', text: 'Shaped on the wheel.' }, { icon: 'ruler', title: 'Trim', text: 'Feet and rims refined.' }, { icon: 'bolt', title: 'Bisque fire', text: '900° for strength.' }, { icon: 'sparkle', title: 'Glaze fire', text: '1240° for the shine.' }] }),
    S('spec-list', { eyebrow: 'Care', heading: 'Living with *stoneware*', rows: 'Dishwasher | Yes, top rack\nMicrowave | Yes\nOven | Up to 200°\nClay | Speckled stoneware\nGlaze | Lead-free', image: '@p1', imageSide: 'right' }),
    S('testimonials', { heading: 'Kind *words*', items: Q(['My morning coffee tastes better in these cups. I am not joking.', 'Inês P.', 'Speckled Cup Set'], ['The class was the best date we have had in years.', 'Sam & Leo', 'Wheel Class for Two'], ['Every plate is slightly different and I love it.', 'Hana M.', 'Lagoon Plate Set']) }),
    S('newsletter', { heading: 'Kiln opening dates', text: 'Be first to shop each new batch.' })],
  currency: ['EUR', 'pt-PT'], payments: 'Card, Wallets',
  footer: { text: 'Wheel-thrown stoneware from a small studio in Lisbon. Every piece one of a kind.' },
});

def({
  id: 'nightshift', name: 'Nightshift', niche: 'Neon sneaker drops', category: 'Fashion', photos: 'sneakers', reviews: true, pdp: 'classic', creative: true,
  description: 'Night-mode sneaker drop store: neon lime and magenta, a tilted ticker, sneakers hanging on a rail and a midnight countdown.',
  theme: { colors: { background: '#07070b', surface: '#14141e', text: '#f2f2f7', muted: '#9a9ab0', primary: '#c6ff3d', primaryText: '#07070b', accent: '#ff2bd6', border: '#26263a' }, fonts: { heading: 'anton', body: 'spacegrotesk', accent: 'dmserif' }, headingWeight: 400, headingCase: 'uppercase', radius: 18, buttons: 'pill', density: 'compact', headerStyle: 'split', cardStyle: 'tagged', imageRatio: 'square', headingScale: 'huge', tracking: 'normal', shadow: 'strong' },
  art: ['#14141e', '#c6ff3d'], swatches: ['#c6ff3d', '#ff2bd6', '#26263a', '#f2f2f7'], heroArt: 'sneaker',
  products: [['Afterglow Runner', 159, 0, 'sneaker', 'Running', { Size: ['40', '41', '42', '43', '44', '45'], Color: ['Grey', 'Black'] }, { ph: ['@p3', '@p1'], tags: ['new'], rating: 4.8, reviews: 143 }], ['Neon Prism', 179, 199, 'sneaker', 'Lifestyle', { Size: ['39', '40', '41', '42', '43'], Color: ['Coral', 'Sky'] }, { ph: ['@p1', '@h1'], tags: ['new'], rating: 4.9, reviews: 87 }],
    ['Midnight Court', 129, 0, 'sneaker', 'Lifestyle', { Size: ['38', '39', '40', '41', '42', '43'], Color: ['White'] }, { ph: ['@p2', '@p0'], rating: 4.7, reviews: 210 }], ['Sand Shift Low', 139, 0, 'sneaker', 'Lifestyle', { Size: ['38', '39', '40', '41', '42'], Color: ['Sand', 'White'] }, { ph: ['@p0', '@h0'], rating: 4.8, reviews: 66 }], ['Glow Care Kit', 29, 0, 'bottle', 'Care', null, { ph: ['@h0', '@p2'] }]],
  home: [S('hero', { layout: 'image', eyebrow: 'Drop 03 · Friday 00:00', heading: 'After hours, *on foot*', text: 'Limited sneakers released at midnight. One pair per person, no bots.', buttonLabel: 'Enter the drop', buttonLink: '#drop', button2Label: 'Shop restocks', button2Link: 'collection:all', image: '@h1', overlay: 45, height: 'full', sticker: 'Drop 03 · Midnight · Limited', textColor: '#f2f2f7' }),
    S('marquee', { text: 'Drop 03 | Midnight release | One pair per person | Raffle closes soon', style: 'solid', separator: '✺', tilt: true, background: '#c6ff3d', textColor: '#07070b', speed: 26 }),
    S('drop-countdown', { eyebrow: 'Drop 03 — Neon Prism', heading: 'Lands at *midnight*', text: '500 pairs worldwide. Enter the raffle before the timer hits zero.', buttonLabel: 'Enter the raffle', buttonLink: 'collection:all', image: '@p1', sticker: 'Raffle · Open now · 500 pairs', background: '#ff2bd6', textColor: '#07070b' }),
    S('rail', { eyebrow: 'Wall of heat', heading: 'Hung up *tonight*', metaRight: '05 pairs / one night', source: 'all', limit: 5, background: '#0d0d14' }),
    S('featured-products', { eyebrow: 'Restocked', heading: 'Back *in the dark*', columns: 4, limit: 4 }),
    S('steps', { eyebrow: 'How drops work', heading: 'Four steps to *the pair*', style: 'line', items: [{ icon: 'card', title: 'Join the raffle', text: 'One entry per person.' }, { icon: 'chat', title: 'Get the text', text: 'Winners hear at 00:05.' }, { icon: 'clock', title: 'Check out in 10 min', text: 'Your pair is held.' }, { icon: 'bolt', title: 'Lace up', text: 'Ships next morning.' }] }),
    S('spec-list', { eyebrow: 'Afterglow Runner', heading: 'Built for *night shifts*', rows: 'Upper | Recycled mesh, reflective yarn\nMidsole | Nitrogen-infused foam\nDrop | 8 mm\nWeight | 248 g (size 42)\nGlow | 360° reflective details', image: '@p3', imageSide: 'right' }),
    S('newsletter', { heading: 'Drop alerts', text: 'A text and an email 10 minutes before every drop.' })],
  footer: { text: 'Limited sneakers released at midnight. One pair per person, no bots.', wordmark: true }, announcement: 'Drop 03 raffle open | One pair per person', annStyle: 'marquee', payments: 'Card, Wallets',
});

def({
  id: 'glasshouse', name: 'Glasshouse', niche: 'Botanical plant shop', category: 'Home & living', photos: 'plants', reviews: true, pdp: 'editorial', creative: true,
  description: 'Editorial botanical shop: deep green and cream, elegant serif type, arched photos, care spec lists and a plant-care timeline.',
  theme: { colors: { background: '#f5f1e6', surface: '#e9e4d2', text: '#1d3326', muted: '#5c6d60', primary: '#1d3326', primaryText: '#f5f1e6', accent: '#c9853f', border: '#d9d3bf' }, fonts: { heading: 'instrument', body: 'manrope', accent: 'instrument' }, headingWeight: 400, headingCase: 'none', radius: 6, buttons: 'solid', density: 'airy', headerStyle: 'centered', cardStyle: 'plain', imageRatio: 'portrait', headingScale: 'huge', tracking: 'tight', shadow: 'none' },
  art: ['#e9e4d2', '#c9853f'], swatches: ['#1d3326', '#9fb29f', '#c9853f', '#e9e4d2'], heroArt: 'plant',
  products: [['Mint Pot Succulent', 24, 0, 'plant', 'Succulents', null, { ph: ['@p0', '@p4'], rating: 4.8, reviews: 112 }], ['Terracotta Cactus', 28, 0, 'plant', 'Succulents', { Size: ['Small', 'Medium'] }, { ph: ['@p1', '@h0'], rating: 4.7, reviews: 64 }],
    ['Potting Kit', 32, 0, 'box', 'Care', null, { ph: ['@p2', '@p1'] }], ['Rubber Fig', 58, 0, 'plant', 'Large plants', { Size: ['60 cm', '90 cm'] }, { ph: ['@p3', '@p7'], tags: ['new'], rating: 4.9, reviews: 41 }], ['Succulent Trio', 39, 0, 'plant', 'Succulents', null, { ph: ['@p4', '@p0'] }],
    ['Bonsai Ficus', 74, 0, 'plant', 'Large plants', null, { ph: ['@p5', '@p3'], rating: 4.9, reviews: 27 }], ['Aloe in Concrete', 34, 0, 'plant', 'Succulents', null, { ph: ['@p6', '@p4'] }], ['Monstera Deliciosa', 69, 79, 'plant', 'Large plants', { Size: ['60 cm', '90 cm'] }, { ph: ['@p7', '@p3'], tags: ['new'], rating: 4.8, reviews: 88 }]],
  home: [S('editorial-hero', { layout: 'split', shape: 'arch', metaLeft: 'The Glasshouse — plants & studio', metaRight: 'Spring catalogue', heading: 'Grow something *quietly wonderful*', dot: false, text: 'Healthy plants, handpicked pots and care advice that actually fits your life.', buttonLabel: 'Shop plants', buttonLink: 'collection:all', button2Label: 'Care guide', button2Link: '#steps', image: '@p7', image2: '@p5', sticker: 'Pet-friendly picks · Spring' }),
    S('marquee', { text: 'Free delivery over $60 | Pet-friendly picks | Care card with every plant | Pots included', style: 'ticker', separator: '✦', background: '#1d3326', textColor: '#f5f1e6', speed: 44 }),
    S('featured-products', { eyebrow: 'Just potted', heading: 'New in the *glasshouse*', columns: 4, limit: 8 }),
    S('split-feature', { eyebrow: 'Plant care', heading: 'Care that *keeps it simple*', text: 'Every plant arrives with a care card, a soil mix chosen for it and a year of free advice.', image: '@p3', shape: 'arch', background: '#1d3326', textColor: '#f5f1e6', imageSide: 'left', items: [{ icon: 'leaf', title: 'Nursery-grown', text: 'Healthy roots, never root-bound.' }, { icon: 'chat', title: 'Plant doctor', text: 'Send a photo, get advice.' }, { icon: 'shield', title: '30-day guarantee', text: 'If it struggles, we replace it.' }] }),
    S('spec-list', { eyebrow: 'Plant profile', heading: 'Aloe, *at a glance*', rows: 'Light | Bright, some direct sun\nWater | Every 2–3 weeks\nPet safe | No — keep out of reach\nGrowth | Slow and steady\nDifficulty | Beginner', image: '@p6', imageSide: 'right', buttonLabel: 'Shop aloe', buttonLink: 'collection:all' }),
    S('polaroids', { eyebrow: 'Customer corners', heading: 'Plants in *real homes*', items: [{ image: '@p7', caption: 'Lisbon flat', note: 'Monstera, 2 years old' }, { image: '@p5', caption: 'Desk buddy', note: 'Bonsai ficus' }, { image: '@p4', caption: 'Windowsill', note: 'Succulent trio' }] }),
    S('steps', { eyebrow: 'Care guide', heading: 'Happy plants in *four steps*', style: 'line', items: [{ icon: 'globe', title: 'Find the light', text: 'Bright, indirect for most.' }, { icon: 'clock', title: 'Water less', text: 'Check the soil first.' }, { icon: 'leaf', title: 'Feed in spring', text: 'Once a month.' }, { icon: 'refresh', title: 'Repot yearly', text: 'One size up.' }] }),
    S('newsletter', { heading: 'Seasonal care notes', text: 'Four letters a year, one per season.' })],
  payments: 'Card, Wallets', freeShipping: 60,
  footer: { text: 'Healthy plants, handpicked pots and care advice that fits your life.' },
});

def({
  id: 'bubbleblock', name: 'Bubble & Block', niche: 'Kids toys', category: 'Hobbies & gifts', photos: 'toys', reviews: true, pdp: 'compact', creative: true,
  description: 'Bubbly kids toy shop: sunny yellow, rounded type, blob-shaped photos, a stickered hero and a make-it timeline.',
  theme: { colors: { background: '#fff8ec', surface: '#ffeccc', text: '#1e2a5a', muted: '#5b6690', primary: '#3a5bff', primaryText: '#ffffff', accent: '#ff6b9a', border: '#f5dfbd' }, fonts: { heading: 'fredoka', body: 'manrope', accent: 'dmserif' }, headingWeight: 600, headingCase: 'none', radius: 32, buttons: 'pill', density: 'comfortable', headerStyle: 'pill', cardStyle: 'tagged', imageRatio: 'square', headingScale: 'large', tracking: 'normal', shadow: 'soft' },
  art: ['#ffeccc', '#ff6b9a'], swatches: ['#ffd84d', '#3a5bff', '#ff6b9a', '#3fc59b'], heroArt: 'blocks',
  products: [['Wooden Train Set', 64, 0, 'blocks', 'Wooden toys', null, { ph: ['@p0', '@p3'], tags: ['new'], rating: 4.9, reviews: 203 }], ['Robot Shelf Friends', 48, 0, 'rocket', 'Collectibles', null, { ph: ['@p1', '@p2'], rating: 4.7, reviews: 58 }],
    ['Rainbow Stacking Rings', 22, 0, 'blocks', 'Baby', { Color: ['Rainbow', 'Pastel'] }, { ph: ['@p2', '@p0'], rating: 4.9, reviews: 311 }], ['Track Expansion Pack', 36, 42, 'blocks', 'Wooden toys', null, { ph: ['@p3', '@p0'], rating: 4.8, reviews: 74 }], ['First Birthday Box', 59, 0, 'box', 'Gift sets', null, { ph: ['@p2', '@p3'], tags: ['new'] }]],
  home: [S('editorial-hero', { layout: 'split', shape: 'blob', metaLeft: 'Toys for ages 1–8', metaRight: 'Wooden · Safe · Joyful', heading: 'Play is *serious* business', dot: true, text: 'Wooden classics and bright little wonders, made with non-toxic paints and lots of love.', buttonLabel: 'Shop toys', buttonLink: 'collection:all', button2Label: 'Gift guide', button2Link: 'collection:all', image: '@p0', image2: '@p2', sticker: 'Wooden · Safe · Joyful', background: '#ffd84d', textColor: '#1e2a5a' }),
    S('marquee', { text: 'Non-toxic paints | Ages 1–8 | Free gift wrap | Plastic-free packaging', style: 'ticker', separator: '●', background: '#3a5bff', textColor: '#ffffff', speed: 38 }),
    S('featured-products', { eyebrow: 'Toy box', heading: 'Toy box *favourites*', columns: 3, limit: 5, buttonLabel: 'All toys' }),
    S('split-feature', { eyebrow: 'Safety first', heading: 'Tested by *tiny hands*', text: 'Every toy is tested to EN 71 and finished with water-based, non-toxic paints.', image: '@p3', shape: 'blob', background: '#ff6b9a', textColor: '#1e2a5a', imageSide: 'right', items: [{ icon: 'shield', title: 'EN 71 tested', text: 'Safe from first birthday.' }, { icon: 'leaf', title: 'FSC wood', text: 'From responsible forests.' }, { icon: 'gift', title: 'Free gift wrap', text: 'With a handwritten card.' }] }),
    S('steps', { eyebrow: 'Our workshop', heading: 'How we *make* toys', style: 'cards', background: '#fff1d6', items: [{ icon: 'heart', title: 'Sketch', text: 'Ideas from real kids.' }, { icon: 'ruler', title: 'Cut', text: 'Sustainably sourced beech.' }, { icon: 'sparkle', title: 'Paint', text: 'Non-toxic, bright colours.' }, { icon: 'gift', title: 'Play', text: 'Wrapped and on its way.' }] }),
    S('polaroids', { eyebrow: 'Play time', heading: 'Snapshots from *playrooms*', items: [{ image: '@p0', caption: 'Rainy Sunday', note: 'Train set, 3 hours straight' }, { image: '@p2', caption: 'First steps', note: 'Stacking rings' }, { image: '@p1', caption: 'The shelf', note: 'Robot friends' }] }),
    S('testimonials', { style: 'big', heading: 'Parents *agree*', rating: '4.9', ratingText: 'From 3,100+ happy families', items: Q(['Our toddler has played with the train every day for a month.', 'Priya N.', 'Mum of two'], ['Beautifully made and the gift wrap was adorable.', 'Tom G.', 'Uncle of the year']) }),
    S('newsletter', { heading: 'Join the play club', text: 'Birthday reminders and 10% off your first order.' })],
  payments: 'Card, Wallets', freeShipping: 50,
  footer: { text: 'Wooden classics and bright little wonders for ages 1–8.' },
});

def({
  id: 'dialtone', name: 'Dial Tone Coffee', niche: 'Retro coffee roaster', category: 'Food & drink', photos: 'coffee', reviews: true, pdp: 'classic', creative: true,
  description: 'Retro coffee roaster: tomato red and cream, chunky grotesk type, circular badges, a brew-guide timeline and tasting notes with dotted leaders.',
  theme: { colors: { background: '#f6ead3', surface: '#efdcb8', text: '#2d1a10', muted: '#77604c', primary: '#e0532a', primaryText: '#fff4e2', accent: '#1f7a6d', border: '#e3cfa8' }, fonts: { heading: 'bricolage', body: 'manrope', accent: 'dmserif' }, headingWeight: 800, headingCase: 'none', radius: 20, buttons: 'pill', density: 'comfortable', headerStyle: 'split', cardStyle: 'card', imageRatio: 'square', headingScale: 'huge', tracking: 'tight', shadow: 'soft' },
  art: ['#efdcb8', '#e0532a'], swatches: ['#e0532a', '#1f7a6d', '#2d1a10', '#f2b33d'], heroArt: 'coffeebag',
  products: [['Hotline House Blend', 16, 0, 'coffeebag', 'Coffee', { Size: ['250 g', '1 kg'], Grind: ['Whole bean', 'Filter', 'Espresso'] }, { ph: ['@p0', '@p4'], tags: ['new'], rating: 4.9, reviews: 412 }], ['Party Line Espresso', 18, 0, 'coffeebag', 'Coffee', { Size: ['250 g', '1 kg'], Grind: ['Whole bean', 'Espresso'] }, { ph: ['@p1', '@p6'], rating: 4.8, reviews: 233 }],
    ['Long Distance Decaf', 17, 0, 'coffeebag', 'Coffee', { Size: ['250 g', '1 kg'] }, { ph: ['@p3', '@p2'], rating: 4.7, reviews: 96 }], ['Operator Single Origin', 21, 0, 'coffeebag', 'Coffee', { Size: ['250 g', '1 kg'] }, { ph: ['@p4', '@p0'], rating: 4.9, reviews: 154 }], ['Pour-Over Starter Kit', 54, 64, 'mug', 'Brewing', null, { ph: ['@p5', '@p4'], rating: 4.8, reviews: 71 }], ['Barista Tool Set', 39, 0, 'mug', 'Brewing', null, { ph: ['@p6', '@p1'] }]],
  home: [S('editorial-hero', { layout: 'collage', metaLeft: 'Roasted every Monday', metaRight: 'Est. 2019 — Line 01', heading: 'Good coffee, *on the line*', dot: false, text: 'Small-batch roasts with big, friendly flavour. Roasted Monday, at your door by Thursday.', buttonLabel: 'Shop coffee', buttonLink: 'collection:all', button2Label: 'Brew guide', button2Link: '#steps', image: '@h1', image2: '@p4', caption: 'line 01', sticker: 'Roasted fresh · Every Monday', background: '#e0532a', textColor: '#fff4e2' }),
    S('marquee', { text: 'Roasted Monday | Shipped Tuesday | Free delivery over $40 | Compostable bags', style: 'solid', separator: '★', tilt: true, background: '#2d1a10', textColor: '#f6ead3', speed: 30 }),
    S('featured-products', { eyebrow: 'On the menu', heading: 'Roasted *this week*', columns: 3, limit: 6 }),
    S('spec-list', { eyebrow: 'Hotline House Blend', heading: 'Tasting *notes*', rows: 'Origin | Brazil & Ethiopia\nRoast | Medium\nNotes | Milk chocolate, red apple, honey\nBest for | Espresso, moka, filter\nAltitude | 1,400–2,000 m', image: '@p0', imageSide: 'left', buttonLabel: 'Shop the blend', buttonLink: 'collection:all' }),
    S('steps', { eyebrow: 'Brew guide', heading: 'Brew it *like a barista*', style: 'line', items: [{ icon: 'ruler', title: 'Grind', text: '15 g, medium-fine.' }, { icon: 'clock', title: 'Bloom', text: '30 g water, 30 seconds.' }, { icon: 'refresh', title: 'Pour', text: 'Slow circles to 250 g.' }, { icon: 'heart', title: 'Sip', text: 'Ready in 3 minutes.' }] }),
    S('split-feature', { eyebrow: 'Subscriptions', heading: 'Subscribe & *never run out*', text: 'Pick a roast and a rhythm. Pause, skip or switch whenever you like.', image: '@p5', shape: 'circle', background: '#1f7a6d', textColor: '#f6ead3', sticker: 'Save 15% · Every delivery', buttonLabel: 'Start a subscription', buttonLink: 'collection:all', items: [{ icon: 'refresh', title: 'Every 2 or 4 weeks', text: 'You choose the rhythm.' }, { icon: 'truck', title: 'Free delivery', text: 'On every subscription box.' }, { icon: 'gift', title: 'Roaster picks', text: 'A surprise bag every 3rd box.' }] }),
    S('drop-countdown', { eyebrow: 'Next roast', heading: 'Monday’s roast *ships in*', text: 'Order before the timer ends to get the freshest beans.', buttonLabel: 'Order now', buttonLink: 'collection:all', image: '@p6', sticker: 'Fresh roast · Monday', background: '#2d1a10', textColor: '#f6ead3', bursts: true }),
    S('testimonials', { heading: 'Regulars *say*', items: Q(['Best house blend I have tried. My moka pot is happy.', 'Rosa M.', 'Subscriber'], ['Fast, fresh and the bags are actually compostable.', 'Ben T.', 'Subscriber'], ['The brew guide fixed my pour-over in one morning.', 'Kai L.', 'Verified buyer']) }),
    S('newsletter', { heading: 'The roast report', text: 'New origins and brew tips, every other week.' })],
  checkout: 'whatsapp', announcement: 'Free delivery over $40 | Roasted every Monday', payments: 'Card, Cash', freeShipping: 40,
  footer: { text: 'Small-batch coffee roasted every Monday. Friendly flavour, on the line.' },
});

const photoSet = t => PHOTOS[t.photos] || PHOTOS.general;
const tokenRef = (set, tok) => {
  const m = /^@(?:([a-z]+):)?([hpu])(\d+)$/.exec(tok); if (!m) return tok;
  if (m[1]) set = PHOTOS[m[1]] || set;
  const list = (m[2] === 'h' ? set.hero : m[2] === 'u' ? set.people || set.hero : set.product) || set.product;
  return 'unsplash:' + list[+m[3] % list.length][0];
};
const resolveTokens = (v, set) => typeof v === 'string' ? tokenRef(set, v) : Array.isArray(v) ? v.map(x => resolveTokens(x, set)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveTokens(x, set)])) : v;

export const STORE_TEMPLATES = T.map(t => ({ id: t.id, name: t.name, niche: t.niche, category: t.category, creative: !!t.creative, description: t.description, swatch: [t.theme.colors.background, t.theme.colors.primary, t.theme.colors.accent], photo: 'unsplash:' + photoSet(t).hero[0][0] }));
export const TEMPLATE_CATEGORIES = [...new Set(T.map(t => t.category))];
/** Gallery filter that cuts across niches: templates built from the creative sections (rail, polaroids, stickers, drops…). */
export const CREATIVE_FILTER = 'Creative';

const REVIEW_POOL = [
  ['Perfect fit', 'Fits true to size and the quality is better than I expected. Already ordered a second one.', 5],
  ['Love it', 'Beautiful material and it arrived beautifully packed. Exactly like the photos.', 5],
  ['Great, runs slightly large', 'Really nice quality. I would size down if you are between sizes.', 4],
  ['Worth it', 'Wore it all week. Comfortable and still looks new after washing.', 5],
  ['Good but slow shipping', 'Lovely product, delivery took a couple of days longer than expected.', 4],
];
const REVIEW_NAMES = ['Amira K.', 'Jonas P.', 'Lea M.', 'Daniel R.', 'Sofia T.', 'Kenji W.', 'Maya L.'];
/** Sample reviews for template products — flagged `sample` so the store shows a “Sample review” tag until the merchant edits them. */
function sampleReviews(i, withPhoto) {
  return [0, 1, 2].map(k => {
    const [title, text, rating] = REVIEW_POOL[(i + k) % REVIEW_POOL.length], d = new Date(Date.UTC(2026, 9, 28 - (i * 3 + k * 5) % 27));
    return { id: uid('r'), name: REVIEW_NAMES[(i * 2 + k) % REVIEW_NAMES.length], rating, title, text, date: d.toISOString().slice(0, 10), photo: k === 0 && withPhoto ? withPhoto : null, sample: true };
  });
}

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
      images: photos, art: gen(kind, abg, sw[i % sw.length], aac, i + 1), options: opts, tags: [slugify(category)], featured: i < 4, status: 'active', rating: null, reviews: 0,
      materials: t.category === 'Fashion' ? 'Outer: 100% organic cotton. Machine wash cold, inside out. Do not tumble dry. Iron on low heat.' : '',
      reviewsList: t.reviews ? sampleReviews(i, set.people ? tokenRef(set, '@u' + i) : null) : [], ...rest };
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
    if ((s.type === 'countdown' || s.type === 'drop-countdown') && !st.endsAt) st.endsAt = new Date(Date.now() + 5 * 864e5 + 7 * 36e5).toISOString().slice(0, 16);
    return { type: s.type, settings: st };
  });
  // in-page anchors used by hero buttons point to a section of the home page
  const homeSections = home.map(s => ({ id: uid('s'), ...s }));
  const anchor = { '#plans': 'pricing', '#curriculum': 'curriculum', '#newsletter': 'newsletter', '#drop': 'drop-countdown', '#rail': 'rail', '#steps': 'steps' };
  const fix = o => { for (const k of ['buttonLink', 'button2Link']) { const want = anchor[o[k]]; if (want) { const target = homeSections.find(x => x.type === want); o[k] = target ? '#' + target.id : 'collection:all'; } } };
  for (const s of homeSections) { fix(s.settings); (s.settings.slides || []).forEach(fix); }
  const [cur, loc] = t.currency || ['USD', 'en-US'];
  const mode = t.checkout || 'whatsapp';
  const email = 'hello@' + slugify(t.name).replace(/-/g, '') + '.example';
  const navCols = t.nav ? collections.filter(c => t.nav.includes(c.title)) : collections.slice(0, 3);
  const store = {
    kind: 'store', templateId: t.id, name: t.name, logo: { text: t.name, image: null, height: 32 }, theme: t.theme, currency: { code: cur, locale: loc }, fallbackArt,
    announcement: { enabled: !!t.announcement, text: t.announcement || 'Free shipping on your first order', link: 'collection:all', style: t.annStyle || 'static' },
    layout: { header: { type: 'header', settings: { sticky: true, transparent: true, showSearch: true, showWishlist: true, badge: t.badge || '', searchPlaceholder: 'Search groceries, bakery, meals…' } }, footer: { type: 'footer', settings: { text: t.description, newsletter: true, payments: t.payments || '', ...(t.footer || {}) } } },
    pages: {
      home: homeSections,
      collection: [S('collection-main', { columns: products.length > 4 ? 3 : 4 })],
      product: [S('product-main', { layout: t.pdp || 'classic', blocks: productBlocks(t.id === 'formfield' ? ['breadcrumb', 'title', 'price', 'variants', 'sizeguide', 'buy', 'specs', 'delivery', 'details'] : t.pdp === 'compact' ? ['title', 'price', 'urgency', 'variants', 'buy', 'delivery', 'trust', 'details'] : undefined, { delivery: t.pdp === 'compact' ? { min: 0, max: 1, text: 'Delivery' } : {} }) }),
        ...(t.productSections || []).map(x => S(x.type, resolveTokens(structuredClone(x.settings), set))),
        S('bundle'), ...(t.reviews ? [S('product-reviews')] : []), S('related-products'),
        ...(t.home.some(x => x.type === 'ugc') ? [S('ugc', resolveTokens(structuredClone(t.home.find(x => x.type === 'ugc').settings), set))] : []),
        S('recently-viewed'), S('features', { style: 'strip', columns: 4, items: STRIP })],
      about: t.about ? t.about.map(x => S(x.type, resolveTokens(structuredClone(x.settings), set))) : [S('page-title', { eyebrow: 'About', heading: `About ${t.name}`, text: '', image: tokenRef(set, '@h1') }),
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
    checkout: { mode, phone: '15550100', email, paymentLinks: {}, freeShipping: t.freeShipping || (digital ? 0 : 100), shippingNote: digital ? '' : 'Shipping is calculated and confirmed with you after ordering.', note: '' },
    seo: { title: `${t.name} — ${t.niche}`, description: t.description },
  };
  return normalizeStore(store);
}
