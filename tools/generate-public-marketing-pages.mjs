import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = 'https://gmt-services.co.uk';

const pages = [
  {
    route: 'services/electric-motor-rewinds-croydon/',
    title: 'Electric Motor Rewinds in Croydon | GMT Electrical Services',
    description: 'Contact GMT Electrical Services in Croydon about an electric motor rewind or repair. Provide the motor details and fault symptoms for workshop advice on the next step.',
    heading: 'Electric Motor Rewinds in Croydon',
    intro: 'GMT Electrical Services has provided motor rewind and repair services from Croydon since 1985. Send the motor details and describe the fault; the workshop team will assess the enquiry, advise on a suitable repair route and confirm the next step.',
    image: 'assets/website/workshop/stator-rewind.jpg',
    imageAlt: 'Motor stator windings at the GMT workshop',
    sections: [
      ['When a rewind may be appropriate', 'A rewind is one possible route when a motor winding is damaged. The appropriate repair depends on the motor and its condition. Include the nameplate details and a description of the fault so the workshop can advise on the next step.', ['Motor make and model, where available', 'What the motor drives and how it is used', 'Symptoms such as overheating, noise or loss of operation']],
      ['Get repair advice from the workshop', 'GMT reviews motor repair and rewind enquiries from its Croydon workshop. Provide the equipment details and fault symptoms; the team will advise on a suitable route and confirm whether the requested work is within scope before proceeding.', ['Call 0208 683 0464', 'Email info@gmt-services.co.uk', 'Or use the enquiry form on the homepage']]
    ],
    related: ['services/electrical-motor-repair/', 'services/ac-motor-rewinding-uk/', 'services/dc-motor-rewinding-london/', 'process/electric-motor-repair/']
  },
  {
    route: 'services/electrical-motor-repair/',
    title: 'Electrical Motor Repair | GMT Electrical Services Croydon',
    description: 'Contact GMT Electrical Services about motor repair, rewinding, testing or replacement enquiries from its Croydon workshop.',
    heading: 'Electrical Motor Repair',
    intro: 'GMT Electrical Services repairs, rewinds and maintains electric motors from its Croydon workshop. Provide the motor details and fault symptoms; the workshop team will assess the enquiry, advise whether repair, rewind or replacement is appropriate and confirm the next step.',
    image: 'assets/website/motor-repair-v2.png',
    imageAlt: 'Electric motor prepared for repair',
    sections: [
      ['Motor faults to describe', 'A clear description helps GMT understand the repair enquiry. Include what the motor is connected to and the symptoms noticed before it stopped or changed performance.', ['Overheating, unusual noise or vibration', 'A motor that will not start or run as expected', 'Recent changes in use or operating conditions']],
      ['Repair, rewind or replacement', 'The appropriate route depends on the motor and its condition. Provide the make, model, nameplate details and fault symptoms. GMT will assess the information and advise whether repair, rewind or replacement should be considered; scope, availability and any quotation are confirmed before work proceeds.', ['Provide make, model and nameplate details', 'Include photos if they help identify the equipment', 'Confirm availability and the next step with the workshop']]
    ],
    related: ['services/electric-motor-rewinds-croydon/', 'services/testing-diagnostics/', 'process/electric-motor-repair/']
  },
  {
    route: 'services/pump-repairs-london/',
    title: 'Pump Repairs in London | GMT Electrical Services',
    description: 'Pump repair, supply and installation enquiries for businesses in London and the South East. Contact GMT Electrical Services in Croydon.',
    heading: 'Pump Repairs in London',
    intro: 'GMT Electrical Services receives pump repair, supply and installation enquiries at its Croydon workshop, including for sump, pool and multi-stage equipment. Provide the pump details, application and fault symptoms; the workshop will assess the request and advise on the appropriate next step.',
    image: 'assets/website/pumps-v2.png',
    imageAlt: 'Pump equipment for repair and installation enquiries',
    sections: [
      ['Pump equipment and faults', 'When contacting GMT, describe the pump type and what it is used for. Let the team know what has changed and whether the pump is at the workshop or at a site.', ['Pump make and model, if known', 'The system or equipment it serves', 'Visible damage, leaks or changes in operation']],
      ['Repair, supply and installation', 'The suitable route depends on the pump type and application. GMT will review the equipment details and advise whether a repair, replacement supply or installation enquiry is appropriate. Scope and availability are confirmed for each request.', ['Sump pumps', 'Pool pumps', 'Multi-stage pumps and other commercial equipment']]
    ],
    related: ['process/pump-repair/', 'services/on-site-engineering/', 'services/testing-diagnostics/']
  },
  {
    route: 'services/fan-repairs-croydon/',
    title: 'Fan Repairs in Croydon | GMT Electrical Services',
    description: 'Contact GMT in Croydon about commercial fan repair or installation, including scroll fans, toilet extractors and boiler fans.',
    heading: 'Fan Repairs in Croydon',
    intro: 'GMT Electrical Services provides repair and installation support for commercial fan equipment. The Croydon team handles enquiries about scroll fans, toilet extractors, boiler fans and other fan systems.',
    image: 'assets/website/fan-repair-v2.png',
    imageAlt: 'Commercial fan equipment',
    sections: [
      ['Fan and ventilation enquiries', 'Describe where the fan is installed, what it serves and the fault symptoms. For equipment at a site, include the location and any access or timing details the team should know.', ['Fan type and make or model, if available', 'Noise, vibration or loss of operation', 'Whether you need repair or installation support']],
      ['Get advice on the next step', 'Provide the fan details, fault symptoms and site information. GMT will review the request, advise on a suitable repair or installation route and confirm scope and availability.', ['Commercial scroll fans', 'Toilet and boiler fans', 'Related extractor equipment']]
    ],
    related: ['services/extractor-fan-repairs-restaurants/', 'process/fan-extractor-servicing/', 'services/on-site-engineering/']
  },
  {
    route: 'services/extractor-fan-repairs-restaurants/',
    title: 'Restaurant Extractor Fan Repairs | GMT Electrical Services',
    description: 'Enquire with GMT Electrical Services about repair, supply or fitting for commercial kitchen extractor fans. Croydon workshop, London and South East enquiries.',
    heading: 'Extractor Fan Repairs for Restaurants',
    intro: 'A problem with a kitchen extractor can affect the people and equipment using the kitchen. GMT Electrical Services handles repair, supply and fitting enquiries for kitchen extractor fans from its Croydon base.',
    image: 'assets/website/kitchen-extractors-v2.png',
    imageAlt: 'Commercial kitchen extractor fan equipment',
    sections: [
      ['Extractor details and fault symptoms', 'Include the site location, extractor or fan type and symptoms. Where safe, provide the make, model or a photo of the unit.', ['Restaurant or commercial kitchen site location', 'Extractor type and equipment details', 'What has changed or stopped working']],
      ['Repair, supply or fitting', 'Provide the extractor details, fault symptoms and site location. GMT will assess the enquiry, advise on a suitable repair, supply or fitting route and confirm scope and availability.', ['Kitchen extractor fan repairs', 'Supply enquiries', 'Fitting and installation enquiries']]
    ],
    related: ['services/fan-repairs-croydon/', 'process/fan-extractor-servicing/', 'services/on-site-engineering/']
  },
  {
    route: 'services/gearbox-repairs-south-london/',
    title: 'Gearbox Repairs in South London | GMT Electrical Services',
    description: 'Mechanical gearbox repair and supply enquiries for South London businesses. Contact GMT Electrical Services in Croydon for workshop advice.',
    heading: 'Gearbox Repairs in South London',
    intro: 'GMT Electrical Services handles mechanical gearbox repair and supply enquiries for businesses in South London and the wider area. Provide the gearbox details, application and fault symptoms; the workshop team will assess the enquiry, advise on a suitable route and confirm the next step.',
    image: 'assets/website/gearbox-repair-v2.png',
    imageAlt: 'Mechanical gearbox equipment',
    sections: [
      ['Gearbox repair enquiries', 'Include the gearbox make and model if available, the equipment it is connected to and the symptoms. Photos of the unit and visible damage give the workshop useful identification details.', ['Noise, vibration or difficulty operating', 'The motor or machinery connected to it', 'Whether you are asking about repair or supply']],
      ['Get advice on repair or supply', 'GMT will review the gearbox details and fault symptoms, then advise whether repair or supply is a suitable route. The team confirms scope and availability for the specific equipment before work proceeds.', ['Mechanical gearbox repairs', 'Supply enquiries', 'Related motor and equipment repair']]
    ],
    related: ['process/gearbox-refurbishment/', 'services/electrical-motor-repair/', 'services/on-site-engineering/']
  },
  {
    route: 'services/ac-motor-rewinding-uk/',
    title: 'AC Motor Rewinding Services | GMT Electrical Services',
    description: 'Contact GMT Electrical Services in Croydon about AC motor rewinding and repair enquiries. Provide your motor details for workshop advice.',
    heading: 'AC Motor Rewinding Services',
    intro: 'For an AC motor rewind or repair enquiry, provide the motor details and fault symptoms. GMT’s Croydon workshop team will assess the information, advise on a suitable route and confirm the scope and availability for your equipment.',
    image: 'assets/website/motor-rewind-v2.png',
    imageAlt: 'Motor rewind work at the workshop',
    sections: [
      ['Information to include', 'The motor nameplate and a clear description of its use help the team understand an AC rewind enquiry.', ['Manufacturer and model', 'Supply and rating information shown on the nameplate', 'What happened before the fault appeared']],
      ['Get advice on the repair route', 'The right route depends on the motor and its condition. GMT will review the nameplate details and fault symptoms, then advise whether a rewind, another repair or a replacement enquiry is appropriate. Scope and availability are confirmed directly with the workshop.', ['Use the enquiry form or phone GMT', 'Add photos where helpful', 'Confirm scope and the next step with the workshop']]
    ],
    related: ['services/electric-motor-rewinds-croydon/', 'services/electrical-motor-repair/', 'process/electric-motor-repair/']
  },
  {
    route: 'services/dc-motor-rewinding-london/',
    title: 'DC Motor Rewinding Specialists | GMT Electrical Services',
    description: 'Contact GMT Electrical Services about a DC motor rewind or repair. Croydon workshop enquiries serving London and the South East.',
    heading: 'DC Motor Rewinding Enquiries in London',
    intro: 'For a DC motor rewind or repair enquiry, provide the motor details and describe the fault. GMT’s Croydon workshop team will review the information, advise on a suitable route and confirm the next step.',
    image: 'assets/website/motor-repair-v2.png',
    imageAlt: 'Electric motor equipment at the GMT workshop',
    sections: [
      ['Identify the motor', 'Include the information shown on the nameplate and explain the motor’s use. These details allow GMT to assess the enquiry and give informed advice on the next step.', ['Manufacturer, model and rating details', 'The equipment the motor operates', 'Fault symptoms and any recent changes']],
      ['Get advice on a rewind or repair', 'GMT will review the equipment information and advise whether the requested DC motor repair or rewind is within scope. The workshop will confirm availability before any work is agreed.', ['Call 0208 683 0464', 'Email info@gmt-services.co.uk', 'Or use the enquiry form on the homepage']]
    ],
    related: ['services/electric-motor-rewinds-croydon/', 'services/electrical-motor-repair/', 'services/testing-diagnostics/']
  },
  {
    route: 'services/testing-diagnostics/',
    title: 'Motor Testing and Diagnostics | GMT Electrical Services',
    description: 'Enquire about motor inspection, testing and fault diagnosis as part of a repair request from GMT Electrical Services in Croydon.',
    heading: 'Motor Testing & Diagnostics',
    intro: 'When a motor stops working or changes in operation, a clear account of the fault helps the workshop assess the repair request. Provide the motor details and symptoms; GMT will advise whether inspection or testing is appropriate as part of the enquiry.',
    image: 'assets/website/workshop/test-bench.jpg',
    imageAlt: 'Electrical testing equipment in the GMT workshop',
    sections: [
      ['Describe the fault', 'Share what the motor does, when the issue started and what equipment it serves. Include any available make, model and nameplate information.', ['Starting or running problems', 'Overheating, noise or vibration', 'Relevant use or operating conditions']],
      ['Get advice on inspection and testing', 'GMT will review the motor details and fault symptoms, then advise whether inspection or testing is appropriate alongside repair or rewind work. The workshop confirms which checks are available for the specific equipment.', ['Motor inspection enquiries', 'Testing associated with repair', 'Repair and replacement routes']]
    ],
    related: ['services/electrical-motor-repair/', 'services/electric-motor-rewinds-croydon/', 'process/electric-motor-repair/']
  },
  {
    route: 'services/balancing/',
    title: 'Motor and Rotor Balancing Enquiries | GMT Electrical Services',
    description: 'Contact GMT Electrical Services about balancing enquiries for motors, fans and rotating equipment from its Croydon workshop.',
    heading: 'Balancing Services',
    intro: 'If vibration or balance is a concern with a motor, fan or rotating assembly, provide GMT with the equipment details and symptoms. The team will assess the request and advise whether it falls within the available balancing scope.',
    image: 'assets/website/workshop/workshop-bench.jpg',
    imageAlt: 'Engineering workshop bench at GMT Electrical Services',
    sections: [
      ['What to include', 'A description of the equipment and the issue helps GMT understand the balancing enquiry.', ['Equipment type and make or model', 'Where and how the equipment is used', 'The vibration or operating symptoms']],
      ['Confirm the service scope', 'Balancing requirements vary with the assembly and its application. GMT will review the equipment details and advise on the appropriate service route; scope and availability are confirmed for each request.', ['Motor and rotor enquiries', 'Fan and rotating assembly enquiries', 'Related inspection or repair needs']]
    ],
    related: ['services/testing-diagnostics/', 'services/fan-repairs-croydon/', 'services/electrical-motor-repair/']
  },
  {
    route: 'services/component-manufacturing/',
    title: 'Engineering Component Repair and Manufacture | GMT Electrical Services',
    description: 'Enquire about component repair or manufacture for motor and electromechanical equipment with GMT Electrical Services in Croydon.',
    heading: 'Component Manufacturing & Precision Repairs',
    intro: 'For a worn or damaged component, provide GMT with the equipment and part details. The workshop will review the request and advise whether repair, replacement, sourcing or a manufacturing enquiry is appropriate.',
    image: 'assets/website/workshop/workshop-bench.jpg',
    imageAlt: 'Engineering tools and equipment at the GMT workshop',
    sections: [
      ['Component details', 'Provide the equipment make and model, component name or part number, and any available photos or measurements. This information supports an accurate assessment.', ['Equipment type and application', 'Component details and visible damage', 'Any drawings or specifications you can share']],
      ['Get advice on the component', 'GMT will review the part details and advise whether repair, sourcing or a manufacturing enquiry is a suitable next step. Any work or supply arrangement is confirmed after assessment.', ['Motor and electromechanical equipment parts', 'Replacement part enquiries', 'Related workshop repair work']]
    ],
    related: ['services/electrical-motor-repair/', 'services/electric-motor-rewinds-croydon/', 'services/testing-diagnostics/']
  },
  {
    route: 'services/on-site-engineering/',
    title: 'On-Site Engineering Support | GMT Electrical Services',
    description: 'Contact GMT Electrical Services about on-site engineering support for motor, pump, fan, extractor and gearbox equipment in London and the South East.',
    heading: 'On-Site Engineering Support',
    intro: 'GMT Electrical Services receives workshop and site repair enquiries across London and the South East. Provide the equipment details, fault symptoms and site location; the team will assess the request and advise whether workshop or on-site support is appropriate.',
    image: 'assets/website/workshop/workshop-signage.jpg',
    imageAlt: 'GMT Electrical Services workshop in Croydon',
    sections: [
      ['Prepare a site enquiry', 'Describe the equipment, fault and site. Include access information and any site constraints for the team to review.', ['Site address and contact details', 'Equipment make, model and use', 'Fault symptoms and requested support']],
      ['Confirm availability and scope', 'Site work depends on the equipment and requirements. GMT will review the site details, advise on a suitable route and confirm availability, scope and next steps for the specific request.', ['Motor and pump enquiries', 'Fan and extractor enquiries', 'Gearbox and related equipment']]
    ],
    related: ['services/pump-repairs-london/', 'services/fan-repairs-croydon/', 'services/breakdown-enquiries/']
  },
  {
    route: 'services/breakdown-enquiries/',
    title: 'Equipment Breakdown Repair Enquiries | GMT Electrical Services',
    description: 'Contact GMT Electrical Services about a motor, pump, fan, extractor or gearbox breakdown. Provide the fault details and location for workshop advice.',
    heading: 'Equipment Breakdown Enquiries',
    intro: 'If equipment has broken down, provide GMT Electrical Services with the equipment details, fault symptoms and location. The workshop will assess the request, advise on the appropriate route and confirm scope and response availability.',
    image: 'assets/website/workshop/pump-repair.jpg',
    imageAlt: 'Equipment being inspected at the GMT workshop',
    sections: [
      ['Tell us what has happened', 'A clear description helps the team understand the breakdown enquiry. If the equipment is at a site, include the location and a contact person.', ['Equipment type, make and model', 'The fault symptoms and when they began', 'Site location and contact information']],
      ['Contact GMT directly', 'For a breakdown enquiry, call GMT or use the enquiry form. Response availability and timing should be confirmed directly with the team.', ['Call 0208 683 0464', 'Email info@gmt-services.co.uk', 'Use the homepage enquiry form']]
    ],
    related: ['services/on-site-engineering/', 'services/electrical-motor-repair/', 'services/pump-repairs-london/']
  },
  {
    route: 'process/electric-motor-repair/',
    title: 'Electric Motor Repair and Rewinding Process | GMT',
    description: 'Learn what motor details to share with GMT when asking about electric motor repair or rewinding from the Croydon workshop.',
    heading: 'How to Start a Motor Repair or Rewind Enquiry',
    intro: 'A motor repair enquiry starts with the equipment identity and a clear description of the fault. GMT Electrical Services will review those details, advise on a suitable repair route and confirm the next step.',
    image: 'assets/website/workshop/stator-rewind.jpg',
    imageAlt: 'Motor winding work at the GMT workshop',
    sections: [
      ['1. Share the equipment details', 'Send the make, model and nameplate information where available. Explain what the motor drives and whether it is available at your site or the workshop.', ['Motor type and rating details', 'Equipment or system it serves', 'Your preferred contact details']],
      ['2. Describe the fault', 'Include when the issue began and what changed. Photos can help identify the unit, but do not dismantle equipment solely to take a photo.', ['Starting or running problem', 'Heat, noise or vibration', 'Any recent change in use']],
      ['3. Get workshop advice', 'GMT will assess the motor details and fault symptoms, then advise whether repair, rewind, testing or replacement is appropriate. Confirm scope, availability and any quotation with the workshop before work proceeds.', ['Motor repair and rewind enquiries', 'Testing and diagnostics', 'Supply or replacement enquiries']]
    ],
    related: ['services/electric-motor-rewinds-croydon/', 'services/electrical-motor-repair/', 'services/testing-diagnostics/']
  },
  {
    route: 'process/pump-repair/',
    title: 'Pump Repair Process and Enquiries | GMT Electrical Services',
    description: 'Prepare a pump repair enquiry with the information GMT needs to advise on repair, supply or installation in London and the South East.',
    heading: 'How to Prepare a Pump Repair Enquiry',
    intro: 'Pump systems vary by application. Provide the pump details, the system it serves and a description of the problem. GMT will assess the enquiry and advise on the appropriate next step.',
    image: 'assets/website/workshop/pump-repair.jpg',
    imageAlt: 'Pump equipment at the GMT workshop',
    sections: [
      ['1. Identify the pump', 'Share the pump type, manufacturer and model where available. Mention whether it is a sump, pool, multi-stage or another type of pump.', ['Pump and motor nameplate details', 'System or equipment served', 'Site or workshop location']],
      ['2. Describe the issue', 'Explain the symptoms and when they occur. Include any relevant site or operating information that helps describe the fault.', ['Loss of operation or unusual noise', 'Visible damage or leakage', 'Any recent maintenance or changes']],
      ['3. Get advice on the service route', 'GMT handles pump repair, supply and installation enquiries. The team will review your equipment information, advise on a suitable route and confirm scope and availability.', ['Repair enquiry', 'Replacement supply enquiry', 'Installation enquiry']]
    ],
    related: ['services/pump-repairs-london/', 'services/on-site-engineering/', 'services/breakdown-enquiries/']
  },
  {
    route: 'process/fan-extractor-servicing/',
    title: 'Fan and Extractor Repair Enquiries | GMT Electrical Services',
    description: 'Find out what to include when contacting GMT about fan, extractor or ventilation equipment repairs and installation support.',
    heading: 'Fan & Extractor Repair Enquiries',
    intro: 'GMT handles enquiries about commercial fans, extractors and related equipment. Provide the site, unit type and fault symptoms so the team can assess the request and advise on suitable support.',
    image: 'assets/website/kitchen-extractors-v2.png',
    imageAlt: 'Commercial kitchen extractor equipment',
    sections: [
      ['1. Describe the equipment', 'Tell GMT where it is installed and what it serves. If available, include the manufacturer, model or an equipment label photo.', ['Scroll, boiler or toilet fan', 'Kitchen extractor or related equipment', 'Commercial site location']],
      ['2. Explain the fault', 'Describe what has changed and whether the equipment has stopped, become noisy or shown visible damage.', ['Fault symptoms', 'When the problem started', 'Any access details for a site enquiry']],
      ['3. Get advice on repair or installation', 'GMT provides fan repair and installation support. The team will review the unit and site details, advise on a suitable route and confirm scope and availability.', ['Fan repair enquiries', 'Extractor supply or fitting enquiries', 'Site support enquiries']]
    ],
    related: ['services/fan-repairs-croydon/', 'services/extractor-fan-repairs-restaurants/', 'services/on-site-engineering/']
  },
  {
    route: 'process/gearbox-refurbishment/',
    title: 'Gearbox Repair and Refurbishment Enquiries | GMT',
    description: 'Prepare a gearbox repair or refurbishment enquiry for GMT Electrical Services with equipment details, symptoms and site information.',
    heading: 'Gearbox Repair & Refurbishment Enquiries',
    intro: 'A gearbox enquiry is easier to review when it includes the gearbox identity, the machinery it serves and a description of the fault. GMT handles mechanical gearbox repair and supply enquiries.',
    image: 'assets/website/gearbox-repair-v2.png',
    imageAlt: 'Mechanical gearbox equipment',
    sections: [
      ['1. Identify the gearbox', 'Share the manufacturer, model, ratio or nameplate details where available, and describe the machinery it is connected to.', ['Gearbox make and model', 'Connected motor or machinery', 'Site or workshop location']],
      ['2. Describe the symptoms', 'Explain what changed and when. Include noise, vibration, leaks or operating issues if they are present.', ['Fault symptoms', 'When the issue began', 'Any visible damage or recent change']],
      ['3. Get advice on repair or supply', 'GMT will review the gearbox details and symptoms, advise whether repair or supply is a suitable route and confirm scope and availability for the specific request.', ['Mechanical gearbox repair enquiries', 'Supply enquiries', 'Related motor repair needs']]
    ],
    related: ['services/gearbox-repairs-south-london/', 'services/electrical-motor-repair/', 'services/on-site-engineering/']
  }
];

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function renderPage(page) {
  const canonical = `${siteRoot}/${page.route}`;
  const sections = page.sections.map(([heading, body, points]) => `
      <section class="marketing-detail-card">
        <h2>${escapeHtml(heading)}</h2>
        <p>${escapeHtml(body)}</p>
        <ul>${points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>
      </section>`).join('');
  const related = page.related.map((route) => {
    const match = pages.find((candidate) => candidate.route === route);
    if (!match) throw new Error(`Missing related page definition: ${route}`);
    return `<li><a href="/${route}">${escapeHtml(match.heading)} <span aria-hidden="true">→</span></a></li>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(page.description)}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" type="image/png" sizes="256x256" href="/assets/brand/gmt-icon-256.png">
  <link rel="stylesheet" href="/public-site.css?v=marketing-refresh-20261012-desktop-nav-v31">
  <script defer src="/viewport-effects.js"></script>
  <meta property="og:title" content="${escapeHtml(page.title)}">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <title>${escapeHtml(page.title)}</title>
</head>
<body class="marketing-page">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="GMT Electrical Services home"><img src="/image.webp" alt="GMT Electrical Services Ltd" width="300" height="78"></a>
  </header>
  <div class="site-nav-bar"><nav class="site-nav" aria-label="Main navigation">
    <a href="/">Home</a><a href="/services/">Services</a><a href="/process/">Repair process</a><a href="/#why-gmt">Why GMT</a><a href="/#workshop-enquiry">Make an enquiry</a><a class="portal-link" href="/portal/">Login</a>
  </nav></div>
  <main id="main-content" class="marketing-page-main">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><a href="/${page.route.split('/')[0]}/">${page.route.startsWith('process/') ? 'Repair process' : 'Services'}</a><span aria-hidden="true">›</span><span aria-current="page">${escapeHtml(page.heading)}</span></nav>
    <section class="marketing-page-hero" data-scroll-reveal data-scroll-snap>
      <div class="marketing-page-copy"><p class="eyebrow">GMT Electrical Services · Croydon</p><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.intro)}</p><div class="hero-actions"><a class="button primary" href="/#workshop-enquiry">Make an enquiry</a><a class="button secondary" href="tel:02086830464">Call 0208 683 0464</a></div></div>
      <img src="/${page.image}" alt="${escapeHtml(page.imageAlt)}" width="1280" height="960" fetchpriority="high" decoding="async">
    </section>
    <div class="marketing-detail-grid" data-scroll-reveal data-scroll-snap>${sections}</div>
    <section class="marketing-related" data-scroll-reveal data-scroll-snap><h2>Related services and guidance</h2><ul>${related}</ul></section>
    <section class="marketing-page-cta" data-scroll-reveal data-scroll-snap><h2>Get advice from the workshop</h2><p>Send GMT the equipment details and fault symptoms. The workshop team will review your enquiry, advise on a suitable next step and confirm scope before any work proceeds.</p><div class="hero-actions"><a class="button primary" href="/#workshop-enquiry">Make an enquiry</a><a class="button secondary" href="tel:02086830464">0208 683 0464</a></div></section>
  </main>
  <footer class="site-footer"><p>GMT Electrical Services Ltd · 93-95 Gloucester Rd, Croydon CR0 2DN · <a href="mailto:info@gmt-services.co.uk">info@gmt-services.co.uk</a></p></footer>
</body>
</html>
`;
}

const landing = {
  services: {
    title: 'Motor, Pump, Fan and Gearbox Services | GMT Electrical Services',
    description: 'Explore GMT Electrical Services motor, pump, fan, extractor and gearbox repair services from the Croydon workshop.',
    heading: 'Workshop & Site Services',
    links: pages.filter((page) => page.route.startsWith('services/'))
  },
  process: {
    title: 'Repair and Rewinding Process Guides | GMT Electrical Services',
    description: 'Prepare a motor, pump, fan, extractor or gearbox repair enquiry for GMT Electrical Services in Croydon.',
    heading: 'Repair Process Guides',
    links: pages.filter((page) => page.route.startsWith('process/'))
  }
};

function renderLandingPage(type, definition) {
  const cards = definition.links.map((page) => `
    <article class="marketing-list-card">
      <p class="eyebrow">${type === 'services' ? 'GMT Service' : 'Helpful guide'}</p>
      <h2><a href="/${page.route}">${escapeHtml(page.heading)}</a></h2>
      <p>${escapeHtml(page.description)}</p>
      <a class="text-link" href="/${page.route}">Read more <span aria-hidden="true">→</span></a>
    </article>`).join('');
  const canonical = `${siteRoot}/${type}/`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(definition.description)}"><link rel="canonical" href="${canonical}"><link rel="icon" type="image/png" sizes="256x256" href="/assets/brand/gmt-icon-256.png"><link rel="stylesheet" href="/public-site.css?v=marketing-refresh-20261012-desktop-nav-v31"><script defer src="/viewport-effects.js"></script><title>${escapeHtml(definition.title)}</title></head>
<body class="marketing-page"><a class="skip-link" href="#main-content">Skip to content</a><header class="site-header"><a class="brand" href="/" aria-label="GMT Electrical Services home"><img src="/image.webp" alt="GMT Electrical Services Ltd" width="300" height="78"></a></header><div class="site-nav-bar"><nav class="site-nav" aria-label="Main navigation"><a href="/">Home</a><a href="/services/">Services</a><a href="/process/">Repair process</a><a href="/#why-gmt">Why GMT</a><a href="/#workshop-enquiry">Make an enquiry</a><a class="portal-link" href="/portal/">Login</a></nav></div>
<main id="main-content" class="marketing-page-main"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><span aria-current="page">${escapeHtml(definition.heading)}</span></nav><section class="marketing-list-hero" data-scroll-reveal data-scroll-snap><p class="eyebrow">GMT Electrical Services · Croydon</p><h1>${escapeHtml(definition.heading)}</h1><p>${escapeHtml(definition.description)}</p></section><div class="marketing-list-grid" data-scroll-reveal data-scroll-snap>${cards}</div><section class="marketing-page-cta" data-scroll-reveal data-scroll-snap><h2>Get advice from the workshop</h2><p>Send GMT the equipment details and fault symptoms. The workshop team will review your enquiry, advise on a suitable next step and confirm scope before any work proceeds.</p><div class="hero-actions"><a class="button primary" href="/#workshop-enquiry">Make an enquiry</a><a class="button secondary" href="tel:02086830464">0208 683 0464</a></div></section></main><footer class="site-footer"><p>GMT Electrical Services Ltd · 93-95 Gloucester Rd, Croydon CR0 2DN · <a href="mailto:info@gmt-services.co.uk">info@gmt-services.co.uk</a></p></footer></body></html>`;
}

const allRoutes = [...Object.keys(landing).map((type) => `${type}/`), ...pages.map((page) => page.route)];
for (const page of pages) {
  const target = path.join(root, page.route, 'index.html');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderPage(page));
}
for (const [type, definition] of Object.entries(landing)) {
  const target = path.join(root, type, 'index.html');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderLandingPage(type, definition));
}

const sitemapUrls = ['', ...allRoutes].map((route) => `  <url><loc>${siteRoot}/${route}</loc></url>`).join('\n');
fs.writeFileSync(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`);
fs.writeFileSync(path.join(root, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /portal/\n\nSitemap: ${siteRoot}/sitemap.xml\n`);
console.log(`Generated ${allRoutes.length} marketing pages and sitemap.`);
