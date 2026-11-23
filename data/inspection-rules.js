const inspectionRules = {
  crawlSpace: {
    reviewSuggested({ height, occupied, flue, plenum }) {
      return height === "gt1.8" || occupied || flue || plenum;
    }
  }
};

const inspectionSectionsBeforeFire = [
  { number: 2, title: "Exterior / Site", items: [
    "Walkways reasonably level and free from significant trip hazards","Exterior lighting operational","Site drainage appears adequate","Water directed away from foundation",
    "No significant standing water","Trees / limbs do not present obvious building hazard","Retaining walls stable",
    "No significant accumulation of combustible debris","Garbage / recycling storage appropriate","Property reasonably maintained",
    "Foundation appears structurally sound","No significant displacement / bowing","No major cracking requiring further assessment",
    "No significant deterioration / spalling","No active water penetration observed","No evidence of significant ongoing moisture problem"
  ]},
  { number: 3, title: "Roof", items: [
    "No significant missing / damaged roofing","No significant deterioration","No visible evidence of active leakage",
    "Flashing appears serviceable","Roof penetrations appear appropriately flashed / sealed","Chimney appears structurally sound",
    "Chimney flashing serviceable",
    "No obvious structural sagging","Roof-mounted equipment appears secure"
  ]},
  { number: 4, title: "Exterior Walls / Windows / Doors", items: [
    "Exterior cladding in good repair","No significant rot / deterioration","No loose materials creating a hazard","Exterior appears reasonably weatherproof",
    "Windows in good repair","No broken glass","Exterior doors in good repair",
    "Exterior doors close / latch securely","Building locks operational","No significant water penetration around openings"
  ]},
  { number: 5, title: "Decks / Balconies / Stairs / Guards", guidance: "Assess current physical condition, structural stability and fall risk. Do not automatically apply current NBC dimensions to original construction unless the current Code is actually triggered by alteration, change of use or another applicable provision. Use <strong>Further Review Required</strong> when the condition is unsafe or Code applicability cannot be established visually.", guidancePdfs: [
    { title: "NBCC 2020 — Section 9.8 Quick Reference", url: "references/nbcc-2020-9-8-quick-reference.pdf" },
    { title: "NBCC 2020 — Section 9.8", url: "references/nbcc-2020-section-9-8.pdf" }
  ], items: [
    "Structure appears stable","No significant rot / corrosion","Connections appear secure","Decking / treads secure","No significant trip hazards",
    "Stairs stable","Handrails secure","Guards secure","No obviously hazardous openings / damage",
    "No evidence of structural movement","No apparent overloading / deterioration"
  ]},
  { number: 6, title: "Interior / Structural Condition", items: [
    "Floors appear structurally sound","No significant floor movement / sagging","Walls appear structurally sound","Ceilings appear structurally sound",
    "No significant structural cracking","No significant water damage","Interior stairs stable","Handrails secure","Guards secure",
    "Common corridors maintained","Floor coverings do not create significant trip hazards","No obvious falling-material hazards"
  ]}
];

const fireItems = {
  smoke: ["Alarms securely mounted","Alarms tested and operational where testing is within inspection scope","No visibly disabled, disconnected or damaged alarms","Alarm appears within manufacturer's stated service life"],
  co: ["CO alarm/detector installed in service room/storage garage","Alarm / detector tested where within inspection scope","Unit appears within manufacturer's service life"],
  egress: ["Required exit routes appear available","Required exit routes, including common corridors and stairs, clear and unobstructed","Exit doors operational","Exit doors readily openable from egress side","No obvious inappropriate locking arrangement","Exterior exit routes usable","Exit stairs / landings appear maintained","Required exit signage appears present where applicable","Emergency lighting appears present / operational where applicable","Secondary egress windows present where applicable","No obvious obstruction of required egress windows"],
  separations: ["No obvious openings or damage in apparent fire separations","Walls / ceilings separating dwelling units appear intact","Walls / ceilings separating dwelling units from common areas appear intact","No obvious unprotected service penetrations","Doors in apparent fire separations are present and serviceable","Fire-rated / self-closing doors function where provided / required","Fire doors not wedged or improperly held open","Mechanical / furnace rooms appear appropriately separated where applicable"],
  alarm: ["Annual inspection records available","Is the control panel functional, with no visible trouble/supervisory condition","Manual pull stations present where required","Audible/visual notification equipment observed","No obvious system damage or impairment"],
  sprinklers: ["Installed sprinkler system appears to serve intended areas","Sprinkler control valves accessible","Valves appear in normal / open position","No obvious damaged sprinkler heads","No obvious obstruction / inappropriate storage around heads","No obvious leakage / corrosion","Inspection / service information or tag observed","Fire department connection accessible where provided"],
  extinguishers: ["Extinguishers readily accessible where required / provided","Appropriate location / mounting","Access unobstructed","No obvious physical damage","Pressure / status indicator appears normal where applicable","Inspection / service tag present where applicable","Servicing appears current"],
  firehazards: ["Electrical / mechanical rooms free of inappropriate storage","Combustibles adequately separated from heat-producing equipment","No excessive accumulation of combustible materials","Flammable / combustible liquids not obviously stored unsafely","Utility areas reasonably maintained","No obvious ignition-source / fire-load concern"]
};

const inspectionSectionsAfterFire = [
  { number: 8, title: "Electrical", guidance: "Visual insurance inspection only; do not remove energized covers or certify Code compliance. Flag visible overheating, exposed wiring, unsafe modifications, water exposure, or uncertain legacy wiring as <strong>Further Review Required</strong> when specialist assessment is appropriate.", guidancePdfs: [
    { title: "PEI Electrical Inspection Act", url: "references/pei-electrical-inspection-act.pdf" }
  ], items: [
    "Service equipment appears in good condition","Electrical panel accessible","Panel cover installed","No missing / open breaker positions",
    "No exposed energized components","No obvious overheating / scorching","No significant corrosion / moisture","Circuit identification present",
    "No obvious improper modifications","Electrical room / panel clearance adequate for safe access","Receptacles / switches securely mounted",
    "Cover plates installed","No exposed / visibly damaged wiring","Junction boxes covered","No obvious makeshift wiring",
    "Extension cords not used as apparent permanent wiring","No obvious overloaded receptacles / power bars",
    "GFCI protection observed in applicable wet locations","Exterior electrical equipment appears weather-protected"
  ]},
  { number: 9, title: "Plumbing", guidance: "Check observable supply, drainage, fixtures and water-heating components for leakage, deterioration, unsafe modifications and serviceability. This is not a plumbing-code certification; use <strong>Further Review Required</strong> where installation compliance cannot be established visually.", items: [
    "Water pressure appears adequate","No active supply leaks observed","No significant corrosion / deterioration",
    "Shutoff valves accessible where observed","Piping protected from freezing where applicable","Fixtures drain adequately","No active drain leaks",
    "No sewage leakage","No significant sewer odour","No obvious inappropriate plumbing modifications","Drain / vent piping appears adequately supported",
    "Water heater appears serviceable","No active water-heater leakage","No significant water-heater corrosion"
  ]},
  { number: 10, title: "Heating / Mechanical", items: [
    "Heating system operational","Equipment appears maintained","No obvious leakage","No obvious combustion / venting concerns","Chimney / flue appears serviceable",
    "Required clearances appear maintained","Combustible materials stored away from heating equipment","Fuel lines / tanks appear serviceable",
    "Heat reaches habitable areas","Thermostats / controls operational","Mechanical room reasonably clean","Ventilation equipment operational where provided"
  ]},
  { number: 11, title: "Oil Tank / Fuel System", items: [
    "Tank appears serviceable","No visible corrosion of concern","No leakage / staining","Tank properly supported","Fill / vent piping appears serviceable",
    "Fuel line appears protected / serviceable","No obvious impact exposure"
  ]},
  { number: 12, title: "Water / Moisture / Mould", items: [
    "Basement reasonably dry","No active foundation leakage","No active plumbing leakage","No significant water staining requiring investigation",
    "No significant condensation","No obvious ongoing moisture damage","No significant visible mould-like growth",
    "No significant rot caused by moisture","Property appears reasonably weatherproof"
  ]},
  { number: 13, title: "Rental Accommodation Standards", guidance: "Use this section as a minimum-health-standard screen for long-term rental accommodation: weatherproofing and dampness, adequate heat, potable hot/cold water, sanitary facilities, ventilation, garbage, pests and general habitability. PEI Environmental Health investigates concerns such as loss of heat or water, sewage issues, pest infestation and mould related to water damage. Use <strong>Further Review Required</strong> when a condition may require Public Health review or the requirement cannot be established visually. <span class='guidance-links'><a href='https://www.princeedwardisland.ca/en/legislation/public-health-act/rental-accommodation-regulations' target='_blank' rel='noopener'>Rental Accommodation Regulations</a> · <a href='https://www.princeedwardisland.ca/en/information/health-and-wellness/rental-accommodations-program' target='_blank' rel='noopener'>Rental Accommodations Program</a> · <a href='https://www.princeedwardisland.ca/en/legislation/residential-tenancy-act' target='_blank' rel='noopener'>Residential Tenancy Act</a></span>", items: [
    "Accommodation appears maintained in a safe and sanitary condition","Building / dwelling unit weatherproof","Free from significant dampness",
    "Heating equipment working and in good repair","Required heat available","Hot running potable water available","Cold running potable water available",
    "Water pressure adequate","Sanitary facilities operational","Bathroom appropriately ventilated","Kitchen facilities provided / operational as applicable",
    "Garbage facilities adequate","No significant pest / vermin infestation observed","Habitable rooms appear suitable for intended use"
  ]},
  { number: 14, title: "Rental Units", items: [
    "Unit entrance door / lock operational","Floors / walls / ceilings in serviceable condition","Heating operational","Plumbing operational",
    "Electrical equipment visually serviceable","Kitchen appears in good condition; ventilation operational and appliances appear in good working order",
    "Bathroom appears in good condition; ventilation operational and fixtures appear in good working order","Smoke alarm arrangement recorded / appears appropriate",
    "CO alarm present where applicable","Exit / egress route unobstructed","No significant water damage","No significant visible mould-like growth",
    "No significant pest evidence","No significant liability / safety hazards"
  ]},
  { number: 15, title: "Basement Dwelling Units / Bedrooms", items: [
    "No significant moisture / dampness","Heating adequate",
    "Ventilation adequate","Smoke / CO detection present as applicable","Exit route appears functional","Bedroom emergency escape provisions show no obvious concern",
    "Fire separation condition appears serviceable","Electrical system visually serviceable","Plumbing system visually serviceable"
  ]},
  { number: 16, title: "Laundry / Utility Areas", items: [
    "Dryer vent connected","Dryer exhaust terminates outdoors","Dryer vent reasonably clean / serviceable","Washing machine connections serviceable",
    "No active leakage","Floor drain / service drainage where applicable","Electrical connections visually appropriate",
    "Area free of excessive combustible storage","Mechanical equipment accessible"
  ]},
  { number: 17, title: "Liability / General Hazards", items: [
    "No significant slip / trip / fall hazards","Common-area lighting adequate","Snow / ice management considerations noted","Pools / hot tubs appropriately protected where applicable",
    "Detached structures appear safe","No abandoned / unsafe structures","No obvious animal-related liability concern"
  ]},
  { number: 18, title: "Alterations / Conditions Requiring Code Review", guidance: "An older component differing from today's construction standards does not by itself establish non-compliance. Use this section when alterations, additions, conversions, changes of use, incomplete work or current unsafe conditions suggest that regulatory or professional review may be warranted. Use <strong>Further Review Required</strong> rather than declaring a Code violation when applicability is uncertain.", items: [
    "Addition","Recent construction","Structural alteration","New dwelling unit","Basement conversion","Change in occupancy / use",
    "Significant electrical alteration","Significant plumbing alteration","Altered exits","Altered fire separations",
    "New deck / balcony / stairs","Work appearing incomplete / unprofessional","Current unsafe condition"
  ]}
];
