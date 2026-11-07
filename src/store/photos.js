// Curated Unsplash photos for the store templates (Unsplash License: free to use, including
// commercially, no permission needed; attribution appreciated — see PHOTO_CREDITS_NOTE).
// Every id below was downloaded and checked by eye; photos showing brand logos, trademarks,
// licensed characters or readable book titles were rejected. Images are hot-linked from
// images.unsplash.com (Unsplash's recommended delivery) with on-the-fly crop/size parameters,
// so the editor preview and exported stores need an internet connection to show them.

export const PHOTO_CREDITS_NOTE = 'Sample photos from Unsplash (unsplash.com), used under the Unsplash License. Replace them with your own product photos.';

/** URL for a curated photo. w/h in px; crop focuses on the centre (or `entropy`). */
export const photoUrl = (id, w = 1200, h = null, opts = {}) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&q=${opts.q || 80}&w=${w}${h ? '&h=' + h : ''}${opts.crop ? '&crop=' + opts.crop : ''}`;

/** id → description of what is visible (used as alt text). Grouped by niche; `hero` = wide scenes. */
export const PHOTOS = {
  fashion: {
    hero: [
      ['1441986300917-64674bd600d8', 'Clothing store interior with shelves and racks'],
      ['1489987707025-afc232f7ea0f', 'Rack of colourful T-shirts'],
      ['1490481651871-ab68de25d43d', 'Minimal clothes rail with neutral garments'],
      ['1515886657613-9f3515b0c78f', 'Model in a yellow tracksuit on a sunny court'],
    ],
    product: [
      ['1521572163474-6864f9cf17ab', 'Plain white T-shirt worn by a model'],
      ['1556821840-3a63f95609a7', 'Grey hoodie seen from the back'],
      ['1434389677669-e08b4cac3105', 'Cream knitted poncho on a hanger'],
      ['1523381210434-271e8be1f52b', 'Sage green shirts on wooden hangers'],
      ['1620799140408-edc6dcb6d633', 'White sweatshirt flat lay with jeans and sneakers'],
      ['1611312449408-fcece27cdbb7', 'Dark denim jacket'],
    ],
    people: [
      ['1503342217505-b0a15ec3261c', 'Woman in a graphic tee against a pink wall'],
      ['1517841905240-472988babdf9', 'Smiling woman in a denim jacket and hood'],
      ['1506794778202-cad84cf45f1d', 'Portrait of a man in a knit sweater'],
      ['1534528741775-53994a69daeb', 'Portrait of a woman in blue light'],
      ['1552374196-1ab2a1c593e8', 'Seated model in a camel blazer'],
    ],
  },
  sneakers: {
    hero: [['1603808033192-082d6919d3e1', 'Beige leather sneaker on an orange backdrop'], ['1560769629-975ec94e6a86', 'Two colourful chunky sneakers on white plinths']],
    product: [
      ['1603808033192-082d6919d3e1', 'Beige and white leather sneaker'],
      ['1560769629-975ec94e6a86', 'Multicolour chunky sneaker'],
      ['1587563871167-1ee9c731aefb', 'Clean white low-top sneaker'],
      ['1562183241-b937e95585b6', 'Grey mesh runner held mid-air'],
    ],
  },
  furniture: {
    hero: [
      ['1586023492125-27b2c045efd7', 'Bright living room with a yellow armchair'],
      ['1524758631624-e2822e304c36', 'Airy lounge with armchairs and a floor lamp'],
      ['1493663284031-b7e3aefcae8e', 'Grey sofa with teal cushions by a window'],
      ['1538688525198-9b88f6f53126', 'Loft living room with sofa and chairs'],
    ],
    product: [
      ['1555041469-a586c61ea9bc', 'Green velvet sofa'],
      ['1567538096630-e0c55bd6374c', 'White tufted armchair'],
      ['1505693416388-ac5ce068fe85', 'Upholstered bed with bench'],
      ['1513694203232-719a280e022f', 'Dresser, small sofa and plant in a white room'],
    ],
  },
  decor: {
    hero: [['1602874801007-bd458bb1b8b6', 'Lit candle with fairy lights'], ['1586023492125-27b2c045efd7', 'Living room corner with art and armchair']],
    product: [
      ['1602874801007-bd458bb1b8b6', 'Glass candle on faux fur'],
      ['1603006905003-be475563bc59', 'Amber jar candle with lights'],
      ['1572726729207-a78d6feb18d7', 'Two amber candles'],
      ['1485955900006-10f4d324d411', 'Succulent in a mint pot'],
    ],
  },
  coffee: {
    hero: [['1501339847302-ac426a4a7cbb', 'Café interior with a lit sign'], ['1495474472287-4d71bcdd2085', 'Friends holding latte cups']],
    product: [
      ['1447933601403-0c6688de566e', 'Roasted coffee beans'],
      ['1511920170033-f8396924c348', 'Espresso portafilters with ground coffee'],
      ['1509042239860-f550ce710b93', 'Two lattes with leaf art'],
      ['1495474472287-4d71bcdd2085', 'Latte art cups'],
      ['1514432324607-a09d9b4aefdd', 'Black coffee in a white cup from above'],
      ['1442512595331-e89e73853f31', 'Pour-over coffee being brewed with a kettle'],
      ['1497935586351-b67a49e012bf', 'Portafilters, ground coffee and a latte on wood'],
    ],
  },
  bakery: {
    hero: [['1517433670267-08bbd4be890f', 'Bakery counter with breads and pastries'], ['1509440159596-0249088772ff', 'Rustic loaves with wheat']],
    product: [
      ['1509440159596-0249088772ff', 'Rustic sourdough loaves'],
      ['1555507036-ab1f4038808a', 'Croissants dusted with sugar'],
      ['1517433670267-08bbd4be890f', 'Assorted pastries in a display'],
    ],
  },
  restaurant: {
    hero: [['1517248135467-4c7edcad34c4', 'Modern restaurant dining room'], ['1414235077428-338989a2e8c0', 'Plated dish at a dinner table']],
    product: [
      ['1504674900247-0877df9cc836', 'Grilled meat and salads'],
      ['1565299624946-b28f40a0ae38', 'Pizza on a wooden board'],
      ['1546069901-ba9599a7e63c', 'Fresh salmon salad bowl'],
      ['1414235077428-338989a2e8c0', 'Plated fine-dining dish'],
    ],
  },
  fitness: {
    hero: [['1534438327276-14e5300c3a48', 'Gym floor with dumbbell racks'], ['1517836357463-d25dfeac3438', 'Athlete lifting a barbell']],
    product: [
      ['1583454110551-21f2fa2afe61', 'Lifting dumbbells in the gym'],
      ['1517963879433-6ad2b056d712', 'Barbell deadlift close-up'],
      ['1571019613454-1cb2f99b2d8b', 'Woman doing sit-ups on a mat'],
      ['1534438327276-14e5300c3a48', 'Dumbbell rack'],
    ],
  },
  outdoor: {
    hero: [['1501555088652-021faa106b9b', 'Hiker with a backpack in a green valley'], ['1551632811-561732d1e306', 'Two hikers on a mountain trail']],
    product: [
      ['1504280390367-361c6d9f38f4', 'View from inside a tent'],
      ['1478131143081-80f7f84ca84d', 'Campfire at night in the forest'],
      ['1501555088652-021faa106b9b', 'Hiking backpack on the trail'],
    ],
  },
  tech: {
    hero: [['1498049794561-7780e7231661', 'Laptop, headphones and phone on a white desk'], ['1496181133206-80ce9b88a853', 'Laptop on a wooden desk']],
    product: [
      ['1505740420928-5e560c06d30e', 'Black headphones on yellow'],
      ['1546435770-a3e426bf472b', 'Over-ear headphones on white'],
      ['1523275335684-37898b6baf30', 'White smartwatch'],
      ['1496181133206-80ce9b88a853', 'Laptop'],
    ],
  },
  beauty: {
    hero: [['1596462502278-27bfdc403348', 'Pink makeup brushes and lipsticks'], ['1608248543803-ba4f8c70ae0b', 'Minimal white cosmetic tubes']],
    product: [
      ['1608248543803-ba4f8c70ae0b', 'White cosmetic tube and box'],
      ['1596462502278-27bfdc403348', 'Makeup brushes and compact'],
      ['1617897903246-719242758050', 'Serum dropper bottle on a wooden tray with eucalyptus'],
      ['1608571423902-eed4a5ad8108', 'Amber dropper bottle on a turned wood stand'],
      ['1596704017254-9b121068fb31', 'Hands holding an eyeshadow palette and brush'],
    ],
  },
  jewelry: {
    hero: [['1599643478518-a784e5dc4c8f', 'Gold pendant necklace in warm light']],
    product: [
      ['1515562141207-7a88fb7ce338', 'Pearl necklace in a box'],
      ['1599643478518-a784e5dc4c8f', 'Gold pendant necklace'],
      ['1602173574767-37ac01994b2a', 'Gold chain bracelet'],
      ['1611591437281-460bfbe1220a', 'Rose-gold bracelet on pink'],
    ],
  },
  plants: {
    hero: [['1463936575829-25148e1db1b8', 'Row of cacti against a pale wall']],
    product: [
      ['1485955900006-10f4d324d411', 'Succulent in a mint pot'],
      ['1459411552884-841db9b3cc2a', 'Cactus in a terracotta pot'],
      ['1416879595882-3373a0480b5b', 'Potting soil and garden trowel'],
      ['1501004318641-b39e6451bec6', 'Rubber fig plant on white'],
      ['1459156212016-c812468e2115', 'Succulents in terracotta pots from above'],
      ['1512428813834-c702c7702b78', 'Small bonsai tree in a white pot'],
      ['1509423350716-97f9360b4e09', 'Aloe in a concrete pot'],
      ['1545241047-6083a3684587', 'Monstera on a wooden stool beside a white chair'],
    ],
  },
  books: {
    hero: [['1507842217343-583bb7270b66', 'Library bookshelves'], ['1524995997946-a1c2e315a42f', 'Curved library shelves']],
    product: [['1495446815901-a7297e633e8d', 'Row of old books'], ['1507842217343-583bb7270b66', 'Bookshelf']],
  },
  pets: {
    hero: [['1548199973-03cce0bbc87b', 'Two dogs running on a path']],
    product: [
      ['1517849845537-4d257902454a', 'Pug in a knit sweater'],
      ['1583337130417-3346a1be7dee', 'French bulldog in a yellow hoodie'],
      ['1514888286974-6c03e2ca1dba', 'Cat peeking over a ledge'],
    ],
  },
  toys: {
    hero: [['1596461404969-9ae70f2830c1', 'Wooden toy train set']],
    product: [['1596461404969-9ae70f2830c1', 'Wooden train and station'], ['1558060370-d644479cb6f7', 'Shelf of vintage toy robots and cars'], ['1618842676088-c4d48a6a7c9d', 'Colourful stacking rings toy'], ['1558877385-81a1c7e67d72', 'Wooden toy train on a track']],
  },
  art: {
    hero: [['1547891654-e66ed7ebb968', 'Colourful street-art mural face'], ['1579783902614-a3fb3927b6a5', 'Still-life flower painting']],
    product: [['1579783902614-a3fb3927b6a5', 'Floral still-life print'], ['1547891654-e66ed7ebb968', 'Mural face print'], ['1513364776144-60967b0f800f', 'Paint brush with red paint']],
  },
  music: {
    hero: [['1598488035139-bdbb2231ce04', 'Recording studio with guitars and mixing desk'], ['1493225457124-a3eb161ffa5f', 'Performer on a smoky stage']],
    product: [['1511379938547-c1f69419868d', 'Home studio with guitars and keyboard'], ['1598488035139-bdbb2231ce04', 'Mixing console']],
  },
  learning: {
    hero: [['1522202176988-66273c2fd55f', 'Students studying together with laptops'], ['1501504905252-473c47e087f8', 'Laptop and notebook on a desk']],
    product: [['1488190211105-8b0e65b80b4e', 'Hand taking notes'], ['1434030216411-0b793f4b4173', 'Writing in a notebook'], ['1501504905252-473c47e087f8', 'Study desk']],
  },
  trading: {
    hero: [['1611974789855-9c2a0a7236a3', 'Candlestick chart on a dark screen'], ['1590283603385-17ffb3a7f29f', 'Trading screen with charts']],
    product: [['1642790106117-e829e14a795f', 'Laptop with trading app and watch'], ['1460925895917-afdab827c52f', 'Laptop with analytics dashboard']],
  },
  business: {
    hero: [['1552664730-d307ca884978', 'Team workshop with sticky notes'], ['1522071820081-009f0129c71c', 'Team working at a shared table']],
    product: [['1600880292203-757bb62b4baf', 'Colleagues high-fiving at a desk'], ['1556761175-b413da4baf72', 'Team meeting in an open office'], ['1460925895917-afdab827c52f', 'Analytics on a laptop']],
  },
  shirts: {
    hero: [['1626497764746-6dc36546b388', 'Colourful shirts on a white clothes rail'], ['1580657018950-c7f7d6a6d990', 'Check tweed jackets on mannequins in a shop']],
    product: [
      ['1596755094514-f87e34085b2c', 'Patterned chambray shirt on a hanger'],
      ['1598033129183-c4f50c736f10', 'Crisp white shirt with a polka-dot tie'],
      ['1626497764746-6dc36546b388', 'Dip-dyed shirts on a rail'],
      ['1608234807905-4466023792f5', 'Woman in a white bow blouse'],
      ['1588359348347-9bc6cbbb689e', 'Smiling man in a pale blue shirt'],
      ['1580657018950-c7f7d6a6d990', 'Check tweed jackets on mannequins'],
    ],
    people: [
      ['1588359348347-9bc6cbbb689e', 'Smiling man in a pale blue shirt'],
      ['1586790170083-2f9ceadc732d', 'Man in a plain white T-shirt'],
      ['1598554747436-c9293d6a588f', 'Woman in a white tee and wide jeans'],
      ['1608234807905-4466023792f5', 'Woman in a white bow blouse'],
    ],
  },
  ceramics: {
    hero: [['1493106641515-6b5631de4bb9', 'Hands shaping a pot on a pottery wheel'], ['1578749556568-bc2c40e68b61', 'Stacked glazed plates and bowls on a shelf']],
    product: [
      ['1610701596007-11502861dcfa', 'Speckled ceramic cups'],
      ['1578749556568-bc2c40e68b61', 'Blue glazed plates and bowls'],
      ['1565193566173-7a0ee3dbe261', 'Grey ceramic bottle vases with dried pods'],
      ['1493106641515-6b5631de4bb9', 'Pot being thrown on a wheel'],
    ],
  },
  objects: {
    hero: [['1540932239986-30128078f3c5', 'Copper pendant lamps'], ['1513506003901-1e6a229e2d15', 'White pendant lamp against a teal wall']],
    product: [
      ['1507473885765-e6ed057f782c', 'Grey floor lamp on white'],
      ['1513506003901-1e6a229e2d15', 'White pendant lamp on teal'],
      ['1494438639946-1ebd1d20bf85', 'Black floor lamp against sage green'],
      ['1503602642458-232111445657', 'Wooden stool on blue'],
      ['1592078615290-033ee584e267', 'Black shell chair on blue'],
      ['1540932239986-30128078f3c5', 'Cluster of copper pendant lamps'],
    ],
  },
  general: {
    hero: [['1441986300917-64674bd600d8', 'Shop interior with shelves'], ['1472851294608-062f824d29cc', 'Open shop sign']],
    product: [['1607082348824-0a96f2a4b9da', 'Red and black shopping bags'], ['1498049794561-7780e7231661', 'Desk gadgets'], ['1602874801007-bd458bb1b8b6', 'Candle'], ['1505740420928-5e560c06d30e', 'Headphones']],
  },
  digital: {
    hero: [['1498050108023-c5249f4df085', 'Laptop with code on a bright desk']],
    product: [['1498050108023-c5249f4df085', 'Code on a laptop'], ['1460925895917-afdab827c52f', 'Dashboard on a laptop'], ['1501504905252-473c47e087f8', 'Notebook and laptop']],
  },
};

/** All curated ids (for tests). */
export const ALL_PHOTO_IDS = [...new Set(Object.values(PHOTOS).flatMap(g => Object.values(g).flat().map(([id]) => id)))];
