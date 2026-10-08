import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = 'https://gmt-services.co.uk';

const pages = [
  {
    route: 'services/electric-motor-rewinds-croydon/',
    title: 'Electric Motor Rewinds in Croydon | GMT Electrical Services',
    description: 'Contact GMT Electrical Services in Croydon about an electric motor rewind or repair. Share the motor details and fault to discuss the available options.',
    heading: 'Electric Motor Rewinds in Croydon',
    intro: 'GMT Electrical Services has provided motor rewind and repair services from Croydon since 1985. If a motor has developed a winding fault or stopped working, send the team its details and describe what has changed.',
    image: 'assets/website/workshop/stator-rewind.jpg',
    imageAlt: 'Motor stator windings at the GMT workshop',
    sections: [
      ['When to ask about a rewind', 'A rewind may be one option when a motor winding is damaged. The right repair route depends on the motor and its condition, so include the nameplate details and a description of the fault in your enquiry.', ['Motor make and model, where available', 'What the motor drives and how it is used', 'Symptoms such as overheating, noise or loss of operation']],
      ['Discuss the next step with GMT', 'GMT can discuss motor repair and rewind enquiries from its Croydon workshop. Contact the team to confirm whether the equipment and requested work are within scope and to arrange the next step.', ['Call 0208 683 0464', 'Email info@gmt-services.co.uk', 'Or use the enquiry form on the homepage']]
    ],
    related: ['services/electrical-motor-repair/', 'services/ac-motor-rewinding-uk/', 'services/dc-motor-rewinding-london/', 'process/electric-motor-repair/']
  },
  {
    route: 'services/electrical-motor-repair/',
    title: 'Electrical Motor Repair | GMT Electrical Services Croydon',
    description: 'Ask GMT Electrical Services about electrical motor repair, rewinding, testing or replacement options from its Croydon workshop.',
    heading: 'Electrical Motor Repair',
    intro: 'GMT Electrical Services repairs, rewinds and maintains electric motors from its Croydon workshop. Share the motor details and fault so the team can discuss a suitable repair or replacement route.',
    image: 'assets/website/motor-repair-v2.png',
    imageAlt: 'Electric motor prepared for repair',
    sections: [
      ['Motor faults to describe', 'A clear description helps GMT understand the repair enquiry. Include what the motor is connected to and the symptoms noticed before it stopped or changed performance.', ['Overheating, unusual noise or vibration', 'A motor that will not start or run as expected', 'Recent changes in use or operating conditions']],
      ['Repair, rewind or replacement', 'The available option depends on the motor and the fault. GMT can discuss repair, rewind, supply or installation enquiries with you before you decide how to proceed.', ['Provide make, model and nameplate details', 'Include photos if they help identify the equipment', 'Ask the team about availability and next steps']]
    ],
    related: ['services/electric-motor-rewinds-croydon/', 'services/testing-diagnostics/', 'process/electric-motor-repair/']
  },
  {
    route: 'services/pump-repairs-london/',
    title: 'Pump Repairs in London | GMT Electrical Services',
    description: 'Pump repair, supply and installation enquiries for businesses in London and the South East. Contact GMT Electrical Services in Croydon.',
    heading: 'Pump Repairs in London',
    intro: 'GMT Electrical Services handles pump repair, supply and installation enquiries from its Croydon workshop. The team works with a range of pumps, including sump, pool and multi-stage equipment.',
    image: 'assets/website/pumps-v2.png',
    imageAlt: 'Pump equipment for repair and installation enquiries',
    sections: [
      ['Pump equipment and faults', 'When contacting GMT, describe the pump type and what it is used for. Let the team know what has changed and whether the pump is at the workshop or at a site.', ['Pump make and model, if known', 'The system or equipment it serves', 'Visible damage, leaks or changes in operation']],
      ['Repair, supply and installation', 'GMT can discuss pump repair, replacement supply and installation enquiries. Contact the team with the equipment details to confirm the options for your pump.', ['Sump pumps', 'Pool pumps', 'Multi-stage pumps and other commercial equipment']]
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
      ['Talk to the workshop', 'Contact GMT to discuss a fan repair or installation enquiry. The team can confirm the next step after reviewing the information about your equipment.', ['Commercial scroll fans', 'Toilet and boiler fans', 'Related extractor equipment']]
    ],
    related: ['services/extractor-fan-repairs-restaurants/', 'process/fan-extractor-servicing/', 'services/on-site-engineering/']
  },
  {
    route: 'services/extractor-fan-repairs-restaurants/',
    title: 'Restaurant Extractor Fan Repairs | GMT Electrical Services',
    description: 'Ask GMT Electrical Services about repair, supply or fitting for commercial kitchen extractor fans. Croydon workshop, London and South East enquiries.',
    heading: 'Extractor Fan Repairs for Restaurants',
    intro: 'A problem with a kitchen extractor can affect the people and equipment using the kitchen. GMT Electrical Services handles repair, supply and fitting enquiries for kitchen extractor fans from its Croydon base.',
    image: 'assets/website/kitchen-extractors-v2.png',
    imageAlt: 'Commercial kitchen extractor fan equipment',
    sections: [
      ['Tell us about the extractor', 'Include the site location, the extractor or fan type, and the symptoms. If you can safely provide the make, model or a photo of the unit, add that to the enquiry.', ['Restaurant or commercial kitchen site location', 'Extractor type and equipment details', 'What has changed or stopped working']],
      ['Repair, supply or fitting', 'GMT can discuss the equipment and the available service route with you. Contact the team to check what support can be arranged for your extractor.', ['Kitchen extractor fan repairs', 'Supply enquiries', 'Fitting and installation enquiries']]
    ],
    related: ['services/fan-repairs-croydon/', 'process/fan-extractor-servicing/', 'services/on-site-engineering/']
  },
  {
    route: 'services/gearbox-repairs-south-london/',
    title: 'Gearbox Repairs in South London | GMT Electrical Services',
    description: 'Mechanical gearbox repair and supply enquiries for South London businesses. Contact GMT Electrical Services in Croydon to discuss your equipment.',
    heading: 'Gearbox Repairs in South London',
    intro: 'GMT Electrical Services handles mechanical gearbox repair and supply enquiries for businesses in South London and the wider area. Share the gearbox details and how it is used so the team can discuss the next step.',
    image: 'assets/website/gearbox-repair-v2.png',
    imageAlt: 'Mechanical gearbox equipment',
    sections: [
      ['Gearbox repair enquiries', 'Include the gearbox make and model if available, the equipment it is connected to and the symptoms. Photos can help identify the unit and any visible damage.', ['Noise, vibration or difficulty operating', 'The motor or machinery connected to it', 'Whether you are asking about repair or supply']],
      ['Discuss refurbishment options', 'Contact GMT to talk through the equipment and repair enquiry. The team can review the information and confirm whether it can assist with the requested work.', ['Mechanical gearbox repairs', 'Supply enquiries', 'Related motor and equipment repair']]
    ],
    related: ['process/gearbox-refurbishment/', 'services/electrical-motor-repair/', 'services/on-site-engineering/']
  },
  {
    route: 'services/ac-motor-rewinding-uk/',
    title: 'AC Motor Rewinding Services | GMT Electrical Services',
    description: 'Contact GMT Electrical Services in Croydon about AC motor rewinding and repair enquiries. Share your motor details to discuss service options.',
    heading: 'AC Motor Rewinding Services',
    intro: 'If you are looking for an AC motor rewind, contact GMT Electrical Services with the motor details and fault symptoms. GMT provides motor rewind enquiries from its Croydon workshop; the team can confirm the available options for your equipment.',
    image: 'assets/website/motor-rewind-v2.png',
    imageAlt: 'Motor rewind work at the workshop',
    sections: [
      ['Information to include', 'The motor nameplate and a clear description of its use help the team understand an AC rewind enquiry.', ['Manufacturer and model', 'Supply and rating information shown on the nameplate', 'What happened before the fault appeared']],
      ['Discuss the repair route', 'The right route depends on the motor and its condition. Contact GMT to discuss whether a rewind, another repair or a replacement enquiry is appropriate.', ['Use the enquiry form or phone GMT', 'Add photos where helpful', 'Ask GMT to confirm scope and next steps']]
    ],
    related: ['services/electric-motor-rewinds-croydon/', 'services/electrical-motor-repair/', 'process/electric-motor-repair/']
  },
  {
    route: 'services/dc-motor-rewinding-london/',
    title: 'DC Motor Rewinding Specialists | GMT Electrical Services',
    description: 'Contact GMT Electrical Services about a DC motor rewind or repair. Croydon workshop enquiries serving London and the South East.',
    heading: 'DC Motor Rewinding Enquiries in London',
    intro: 'For a DC motor rewind or repair enquiry, share the motor details and what has gone wrong. GMT Electrical Services is based in Croydon and can discuss the available service options with you.',
    image: 'assets/website/motor-repair-v2.png',
    imageAlt: 'Electric motor equipment at the GMT workshop',
    sections: [
      ['Help identify the motor', 'Include the information shown on the nameplate and explain the motor’s use. This gives GMT a starting point for discussing your enquiry.', ['Manufacturer, model and rating details', 'The equipment the motor operates', 'Fault symptoms and any recent changes']],
      ['Ask about a rewind or repair', 'Contact GMT to discuss a DC motor repair enquiry. The team can review the equipment information and confirm whether the requested work is within scope.', ['Call 0208 683 0464', 'Email info@gmt-services.co.uk', 'Or use the enquiry form on the homepage']]
    ],
    related: ['services/electric-motor-rewinds-croydon/', 'services/electrical-motor-repair/', 'services/testing-diagnostics/']
  },
  {
    route: 'services/testing-diagnostics/',
    title: 'Motor Testing and Diagnostics | GMT Electrical Services',
    description: 'Talk to GMT Electrical Services about motor inspection, testing and fault diagnosis as part of a repair enquiry from its Croydon workshop.',
    heading: 'Motor Testing & Diagnostics',
    intro: 'When a motor has stopped working or changed in operation, a clear account of the fault helps guide the repair conversation. Contact GMT about inspection and testing as part of your motor repair enquiry.',
    image: 'assets/website/workshop/test-bench.jpg',
    imageAlt: 'Electrical testing equipment in the GMT workshop',
    sections: [
      ['Describe the fault', 'Share what the motor does, when the issue started and what equipment it serves. Include any available make, model and nameplate information.', ['Starting or running problems', 'Overheating, noise or vibration', 'Relevant use or operating conditions']],
      ['Ask about testing', 'GMT can discuss testing and diagnostic enquiries alongside repair and rewind work. Contact the workshop to confirm which checks are available for your equipment.', ['Motor inspection enquiries', 'Testing associated with repair', 'Repair and replacement options']]
    ],
    related: ['services/electrical-motor-repair/', 'services/electric-motor-rewinds-croydon/', 'process/electric-motor-repair/']
  },
  {
    route: 'services/balancing/',
    title: 'Motor and Rotor Balancing Enquiries | GMT Electrical Services',
    description: 'Ask GMT Electrical Services about balancing enquiries for motors, fans and rotating equipment from its Croydon workshop.',
    heading: 'Balancing Services',
    intro: 'If vibration or balance is a concern with a motor, fan or rotating assembly, contact GMT with the equipment details. The team can discuss whether balancing support is available for your enquiry.',
    image: 'assets/website/workshop/workshop-bench.jpg',
    imageAlt: 'Engineering workshop bench at GMT Electrical Services',
    sections: [
      ['What to include', 'A description of the equipment and the issue helps GMT understand the balancing enquiry.', ['Equipment type and make or model', 'Where and how the equipment is used', 'The vibration or operating symptoms']],
      ['Confirm the service scope', 'Balancing requirements vary with the assembly and its use. Contact GMT to discuss the equipment and confirm the appropriate service route.', ['Motor and rotor enquiries', 'Fan and rotating assembly enquiries', 'Related inspection or repair needs']]
    ],
    related: ['services/testing-diagnostics/', 'services/fan-repairs-croydon/', 'services/electrical-motor-repair/']
  },
  {
    route: 'services/component-manufacturing/',
    title: 'Engineering Component Repair and Manufacture | GMT Electrical Services',
    description: 'Discuss component repair or manufacturing enquiries for motor and electromechanical equipment with GMT Electrical Services in Croydon.',
    heading: 'Component Manufacturing & Precision Repairs',
    intro: 'Some repair enquiries involve a worn or damaged component. Contact GMT with the equipment and part details to discuss whether repair, replacement or a custom component enquiry is appropriate.',
    image: 'assets/website/workshop/workshop-bench.jpg',
    imageAlt: 'Engineering tools and equipment at the GMT workshop',
    sections: [
      ['Help identify the component', 'Provide the equipment make and model, the component name or part number, and photos or measurements if available.', ['Equipment type and application', 'Component details and visible damage', 'Any drawings or specifications you can share']],
      ['Discuss possible options', 'GMT can review the enquiry and discuss whether the part can be repaired, sourced or referred for manufacture.', ['Motor and electromechanical equipment parts', 'Replacement part enquiries', 'Related workshop repair work']]
    ],
    related: ['services/electrical-motor-repair/', 'services/electric-motor-rewinds-croydon/', 'services/testing-diagnostics/']
  },
  {
    route: 'services/on-site-engineering/',
    title: 'On-Site Engineering Support | GMT Electrical Services',
    description: 'Contact GMT Electrical Services about on-site engineering support for motor, pump, fan, extractor and gearbox equipment in London and the South East.',
    heading: 'On-Site Engineering Support',
    intro: 'GMT Electrical Services supports workshop and site repair enquiries across London and the South East. Contact the team with your equipment details and site location to discuss what support may be available.',
    image: 'assets/website/workshop/workshop-signage.jpg',
    imageAlt: 'GMT Electrical Services workshop in Croydon',
    sections: [
      ['Plan a site enquiry', 'Describe the equipment, the issue and the site. Include access information or any constraints that could help the team review the request.', ['Site address and contact details', 'Equipment make, model and use', 'Fault symptoms and requested support']],
      ['Confirm availability and scope', 'Site work depends on the equipment and requirements. Contact GMT to discuss the enquiry and confirm availability, scope and next steps.', ['Motor and pump enquiries', 'Fan and extractor enquiries', 'Gearbox and related equipment']]
    ],
    related: ['services/pump-repairs-london/', 'services/fan-repairs-croydon/', 'services/breakdown-enquiries/']
  },
  {
    route: 'services/breakdown-enquiries/',
    title: 'Equipment Breakdown Repair Enquiries | GMT Electrical Services',
    description: 'Contact GMT Electrical Services about a motor, pump, fan, extractor or gearbox breakdown. Share the fault and location to discuss next steps.',
    heading: 'Equipment Breakdown Enquiries',
    intro: 'If equipment has broken down, contact GMT Electrical Services with the fault, equipment details and location. The team can discuss the request and confirm whether it can assist.',
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
    intro: 'A useful motor repair enquiry starts with the equipment identity and a description of the fault. GMT Electrical Services can then discuss which service options may fit the request.',
    image: 'assets/website/workshop/stator-rewind.jpg',
    imageAlt: 'Motor winding work at the GMT workshop',
    sections: [
      ['1. Share the equipment details', 'Send the make, model and nameplate information where available. Explain what the motor drives and whether it is available at your site or the workshop.', ['Motor type and rating details', 'Equipment or system it serves', 'Your preferred contact details']],
      ['2. Describe the fault', 'Include when the issue began and what changed. Photos can help identify the unit, but do not dismantle equipment solely to take a photo.', ['Starting or running problem', 'Heat, noise or vibration', 'Any recent change in use']],
      ['3. Discuss available options', 'Contact GMT to discuss whether repair, rewind, testing or replacement is relevant. Ask the team to confirm scope, availability and any quotation before work proceeds.', ['Motor repair and rewind enquiries', 'Testing and diagnostics', 'Supply or replacement enquiries']]
    ],
    related: ['services/electric-motor-rewinds-croydon/', 'services/electrical-motor-repair/', 'services/testing-diagnostics/']
  },
  {
    route: 'process/pump-repair/',
    title: 'Pump Repair Process and Enquiries | GMT Electrical Services',
    description: 'Prepare a pump repair enquiry with the information GMT needs to discuss repair, supply and installation options in London and the South East.',
    heading: 'How to Prepare a Pump Repair Enquiry',
    intro: 'Pump systems vary by application. Provide the pump details, the system it serves and a description of the problem so GMT can discuss the enquiry with you.',
    image: 'assets/website/workshop/pump-repair.jpg',
    imageAlt: 'Pump equipment at the GMT workshop',
    sections: [
      ['1. Identify the pump', 'Share the pump type, manufacturer and model where available. Mention whether it is a sump, pool, multi-stage or another type of pump.', ['Pump and motor nameplate details', 'System or equipment served', 'Site or workshop location']],
      ['2. Describe the issue', 'Explain the symptoms and when they occur. Include any relevant site or operating information that helps describe the fault.', ['Loss of operation or unusual noise', 'Visible damage or leakage', 'Any recent maintenance or changes']],
      ['3. Discuss the service route', 'GMT handles pump repair, supply and installation enquiries. Contact the team to discuss the available option for your equipment.', ['Repair enquiry', 'Replacement supply enquiry', 'Installation enquiry']]
    ],
    related: ['services/pump-repairs-london/', 'services/on-site-engineering/', 'services/breakdown-enquiries/']
  },
  {
    route: 'process/fan-extractor-servicing/',
    title: 'Fan and Extractor Repair Enquiries | GMT Electrical Services',
    description: 'Find out what to include when contacting GMT about fan, extractor or ventilation equipment repairs and installation support.',
    heading: 'Fan & Extractor Repair Enquiries',
    intro: 'GMT handles enquiries about commercial fans, extractors and related equipment. The site, unit type and fault symptoms help the team understand what support is being requested.',
    image: 'assets/website/kitchen-extractors-v2.png',
    imageAlt: 'Commercial kitchen extractor equipment',
    sections: [
      ['1. Describe the equipment', 'Tell GMT where it is installed and what it serves. If available, include the manufacturer, model or an equipment label photo.', ['Scroll, boiler or toilet fan', 'Kitchen extractor or related equipment', 'Commercial site location']],
      ['2. Explain the fault', 'Describe what has changed and whether the equipment has stopped, become noisy or shown visible damage.', ['Fault symptoms', 'When the problem started', 'Any access details for a site enquiry']],
      ['3. Discuss repair or installation', 'GMT provides fan repair and installation support. Contact the team to discuss what may be suitable for the unit and site.', ['Fan repair enquiries', 'Extractor supply or fitting enquiries', 'Site support enquiries']]
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
      ['3. Ask about repair or supply', 'Contact GMT to discuss the gearbox and confirm whether repair or supply support is available for the request.', ['Mechanical gearbox repair enquiries', 'Supply enquiries', 'Related motor repair needs']]
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
  <link rel="stylesheet" href="/public-site.css?v=marketing-refresh-20261006-v16">
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
    <section class="marketing-page-hero">
      <div class="marketing-page-copy"><p class="eyebrow">GMT Electrical Services · Croydon</p><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.intro)}</p><div class="hero-actions"><a class="button primary" href="/#workshop-enquiry">Make an enquiry</a><a class="button secondary" href="tel:02086830464">Call 0208 683 0464</a></div></div>
      <img src="/${page.image}" alt="${escapeHtml(page.imageAlt)}" width="1280" height="960" fetchpriority="high" decoding="async">
    </section>
    <div class="marketing-detail-grid">${sections}</div>
    <section class="marketing-related"><h2>Related services and guidance</h2><ul>${related}</ul></section>
    <section class="marketing-page-cta"><h2>Talk to GMT about your equipment</h2><p>Call the Croydon workshop or send details through the enquiry form. GMT can confirm the next step after reviewing your request.</p><div class="hero-actions"><a class="button primary" href="/#workshop-enquiry">Make an enquiry</a><a class="button secondary" href="tel:02086830464">0208 683 0464</a></div></section>
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(definition.description)}"><link rel="canonical" href="${canonical}"><link rel="icon" type="image/png" sizes="256x256" href="/assets/brand/gmt-icon-256.png"><link rel="stylesheet" href="/public-site.css?v=marketing-refresh-20261006-v16"><title>${escapeHtml(definition.title)}</title></head>
<body class="marketing-page"><a class="skip-link" href="#main-content">Skip to content</a><header class="site-header"><a class="brand" href="/" aria-label="GMT Electrical Services home"><img src="/image.webp" alt="GMT Electrical Services Ltd" width="300" height="78"></a></header><div class="site-nav-bar"><nav class="site-nav" aria-label="Main navigation"><a href="/">Home</a><a href="/services/">Services</a><a href="/process/">Repair process</a><a href="/#why-gmt">Why GMT</a><a href="/#workshop-enquiry">Make an enquiry</a><a class="portal-link" href="/portal/">Login</a></nav></div>
<main id="main-content" class="marketing-page-main"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><span aria-current="page">${escapeHtml(definition.heading)}</span></nav><section class="marketing-list-hero"><p class="eyebrow">GMT Electrical Services · Croydon</p><h1>${escapeHtml(definition.heading)}</h1><p>${escapeHtml(definition.description)}</p></section><div class="marketing-list-grid">${cards}</div><section class="marketing-page-cta"><h2>Discuss a repair enquiry with GMT</h2><p>Call the Croydon workshop or send details through the enquiry form.</p><div class="hero-actions"><a class="button primary" href="/#workshop-enquiry">Make an enquiry</a><a class="button secondary" href="tel:02086830464">0208 683 0464</a></div></section></main><footer class="site-footer"><p>GMT Electrical Services Ltd · 93-95 Gloucester Rd, Croydon CR0 2DN · <a href="mailto:info@gmt-services.co.uk">info@gmt-services.co.uk</a></p></footer></body></html>`;
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
