/**
 * Dynamic example text for forms, based on the business vocabulary.
 * Used by Business Map and Setup Wizard to show contextual placeholders.
 */

export interface VocabularyLike {
  serviceLabel: string;
  departmentLabel: string;
}

export interface VocabularyExamples {
  services: string;
  departments: string;
  placeholderService: string;
  placeholderCode: string;
  placeholderDept: string;
  placeholderDeptCode: string;
}

export function getVocabularyExamples(v: VocabularyLike): VocabularyExamples {
  const sl = v.serviceLabel.toLowerCase();
  const dl = v.departmentLabel.toLowerCase();

  if (sl === 'menu item' || sl === 'dish')
    return { services: 'Margherita Pizza, Caesar Salad, Espresso', departments: 'Kitchen, Bar, Desserts', placeholderService: 'e.g. Margherita Pizza', placeholderCode: 'e.g. PIZZA-M', placeholderDept: 'e.g. Kitchen', placeholderDeptCode: 'e.g. KITCHEN' };

  if (sl === 'treatment' || sl === 'procedure')
    return { services: 'General Check-up, Blood Test, X-Ray', departments: 'Consultation, Laboratory, Radiology', placeholderService: 'e.g. General Check-up', placeholderCode: 'e.g. CHECKUP', placeholderDept: 'e.g. Consultation', placeholderDeptCode: 'e.g. CONSULT' };

  if (sl === 'transaction' || dl === 'window')
    return { services: 'Cash Withdrawal, Account Opening, Money Transfer', departments: 'Teller, Customer Service, Loans', placeholderService: 'e.g. Cash Withdrawal', placeholderCode: 'e.g. CASH-WD', placeholderDept: 'e.g. Teller', placeholderDeptCode: 'e.g. TELLER' };

  if (sl === 'request' || sl === 'application')
    return { services: 'ID Renewal, Permit Application, Certificate Request', departments: 'Civil Status, Permits, Certificates', placeholderService: 'e.g. ID Renewal', placeholderCode: 'e.g. ID-RENEW', placeholderDept: 'e.g. Civil Status', placeholderDeptCode: 'e.g. CIVIL' };

  // Default / generic
  return { services: 'General Visit, Consultation, Renewal', departments: 'Reception, Customer Service, Cashier', placeholderService: 'e.g. General Visit', placeholderCode: 'e.g. GEN-VISIT', placeholderDept: 'e.g. Reception', placeholderDeptCode: 'e.g. RECEPTION' };
}
