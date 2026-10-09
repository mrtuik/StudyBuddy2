import {
  Activity, Atom, BookOpen, Bone, Brain, Bug, Calculator, Code, Dna, Droplets, FlaskConical, Globe, HeartPulse,
  Landmark, Languages, Leaf, Microscope, Pill, Scale, ShieldCheck, Stethoscope, Syringe, TestTube, type LucideIcon,
} from 'lucide-react';

// first match wins, so specific words go before general ones
const RULES: [RegExp, LucideIcon][] = [
  [/micro|virolog|mycolog|bacteri/, Microscope],
  [/histo|cyto|biops/, Microscope],
  [/parasit|entomolog|helminth|protozo/, Bug],
  [/hemat|blood|serolog|transfus|urine|urin/, Droplets],
  [/immun|vaccin/, ShieldCheck],
  [/biochem|chem|reagent|solution/, FlaskConical],
  [/patholog|diagnos|specimen/, TestTube],
  [/genetic|dna|molecul|biotech/, Dna],
  [/anatom|skelet|ortho/, Bone],
  [/physiolog/, Activity],
  [/cardio|heart|ecg/, HeartPulse],
  [/neuro|brain|psych/, Brain],
  [/pharma|drug|medicin/, Pill],
  [/nurs|clinic|patient|health|first aid/, Stethoscope],
  [/inject|phlebot|syring/, Syringe],
  [/physic|atom|quantum|mechanic/, Atom],
  [/math|calcul|algebra|geometr|trigon|statist|aptitude|reasoning/, Calculator],
  [/biolog|botan|zoolog|ecolog|environment|agricult/, Leaf],
  [/english|hindi|bengali|bangla|urdu|sanskrit|language|grammar|literature/, Languages],
  [/histor|civic|polit|polity|econom|constitution/, Landmark],
  [/geograph|geolog|earth/, Globe],
  [/comput|program|coding|software|python|java|web|data|tech/, Code],
  [/law|legal|ethic/, Scale],
  [/lab|practical|viva/, TestTube],
];

export function subjectIcon(title: string): LucideIcon {
  const t = title.toLowerCase();
  return RULES.find(([re]) => re.test(t))?.[1] ?? BookOpen;
}
