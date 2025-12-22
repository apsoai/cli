export enum TypeOrmErrorCodes {
  DuplicateKeyError = 'DuplicateKeyError',
  GeneralError = 'GeneralError',
}

const codeMapping = {
  '23505': TypeOrmErrorCodes.DuplicateKeyError,
};

export const getTypeOrmErrorCode = (value: string): string => {
  return (codeMapping[value] || TypeOrmErrorCodes.GeneralError).toString();
};
