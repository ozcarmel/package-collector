const israeliMobilePattern = /^9725\d{8}$/;

export function toWhatsAppPhoneNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  let internationalNumber = digits;

  if (digits.startsWith("00972")) {
    internationalNumber = digits.slice(2);
  } else if (digits.startsWith("0")) {
    internationalNumber = `972${digits.slice(1)}`;
  } else if (digits.startsWith("5") && digits.length === 9) {
    internationalNumber = `972${digits}`;
  }

  return israeliMobilePattern.test(internationalNumber) ? internationalNumber : null;
}

export function createWhatsAppUrl(phone: string) {
  const number = toWhatsAppPhoneNumber(phone);
  return number ? `https://wa.me/${number}` : null;
}
