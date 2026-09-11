import { DEFAULTS } from './model.js';

// Engineering examples, not measured plant campaigns. Each baseline is solved
// from its own material, energy, VLE and hydraulic equations before it starts.
export const CASES = [
  {
    id:'reference',number:'01',name:'Der Referenzbetrieb',tag:'GUTER START',accent:'blue',
    description:'Benzol und Toluol trennen sich auf 18 realen Modellböden. Beide Produkte sind bereits hoch angereichert.',
    watch:'Ändere den Rücklauf oder die Heizleistung und beobachte beide Produkte. Eine hohe Kopfreinheit allein sagt wenig über die gesamte Trennung.',
    params:{},events:[],
  },
  {
    id:'feed-step',number:'02',name:'Plötzlich mehr Zulauf',tag:'STÖRUNG',accent:'orange',
    description:'Nach zwei Minuten steigt der Feed um 25 %. Die Füllstandsregler und die Bodenhydraulik reagieren.',
    watch:'Die Flüssigkeitswelle wandert vom Feedboden nach unten. Reinheiten und Behälterfüllstände folgen auf unterschiedlichen Zeitskalen.',
    params:{},events:[{at:120,label:'Feed +25 %',patch:{feed:100}}],
  },
  {
    id:'cold-feed',number:'03',name:'Der kalte Feed',tag:'ENERGIEBILANZ',accent:'orange',
    description:'Der Feed wechselt nach zwei Minuten von siedender Flüssigkeit auf 40 °C. Die Heizung bleibt gleich.',
    watch:'Ein Teil des aufsteigenden Dampfs kondensiert, um den Feed zu erwärmen. Vergleiche die Dampfströme ober- und unterhalb des Feedbodens.',
    params:{},events:[{at:120,label:'Feed auf 40 °C',patch:{feedMode:'temperature',feedTemperature:40}}],
  },
  {
    id:'ethanol',number:'04',name:'Ethanol trifft Wasser',tag:'NRTL',accent:'mint',
    description:'Ein nichtideales Gemisch mit 35 mol-% Ethanol, 24 Böden und temperaturabhängiger Mischungsenthalpie.',
    watch:'Im Gleichgewichtsdiagramm ist der Abstand zwischen Flüssigkeit und Dampf nicht konstant. Das NRTL-Modell berücksichtigt die Wechselwirkungen des Gemischs.',
    params:{system:'ethanol-water',trays:24,feedTray:14,feedX:.35,heatMW:1.68,qualityTarget:.83},events:[],
  },
  {
    id:'azeotrope',number:'05',name:'Die Grenze der Trennung',tag:'AZEOTROP',accent:'mint',
    description:'Ethanolreicher Feed, 32 Böden und viel Rücklauf. Die azeotrope Grenze rückt in Sicht.',
    watch:'Flüssigkeits- und Dampfzusammensetzung nähern sich am Azeotrop an. Mehr Böden überwinden diese Grenze bei festem Druck nicht.',
    params:{system:'ethanol-water',trays:32,feedTray:18,feedX:.75,reflux:200,heatMW:2.6,efficiency:.9,coolingWater:160,condenserUA:110000,qualityTarget:.88},events:[],
  },
  {
    id:'vacuum',number:'06',name:'Trennen unter Vakuum',tag:'DRUCK',accent:'blue',
    description:'n-Hexan und n-Heptan bei 0,65 bar Kopfdruck. Die gleiche Trennaufgabe hat andere Siedetemperaturen.',
    watch:'Vergleiche das Temperaturprofil mit einem Betriebspunkt bei 1,013 bar. Beachte auch das größere Dampfvolumen bei niedrigerem Druck.',
    params:{system:'hexane-heptane',pressureBar:.65,pressureDropMbar:3,heatMW:1.32,qualityTarget:.97},events:[],
  },
  {
    id:'efficiency',number:'07',name:'Wenn Böden weniger schaffen',tag:'BODENWIRKUNG',accent:'orange',
    description:'Wie im Referenzbetrieb, aber mit 45 % statt 75 % Murphree-Effizienz pro Boden.',
    watch:'Die Anzahl realer Böden bleibt gleich. Der austretende Dampf nähert sich dem Gleichgewicht weniger stark an und die Trennschärfe sinkt.',
    params:{efficiency:.45},events:[],
  },
  {
    id:'quality-control',number:'08',name:'Der Regler übernimmt',tag:'REGELUNG',accent:'blue',
    description:'Ein PI-Regler hält die Kopfreinheit über den Rücklauf. Nach zwei Minuten sinkt der Benzolanteil im Feed.',
    watch:'Der Regler sieht die Reinheit durch einen 15-s-Messfilter. Beobachte Stellbewegung, Produktabzug und mögliche Grenzen der Regelung.',
    params:{qualityAuto:true,qualityTarget:.98},events:[{at:120,label:'Feedanteil A auf 45 mol-%',patch:{feedX:.45}}],
  },
];
export const getCase = id => CASES.find(c=>c.id===id)??CASES[0];
export const caseParams = id => ({...DEFAULTS,...getCase(id).params});
