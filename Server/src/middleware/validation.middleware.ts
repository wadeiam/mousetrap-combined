import { Request, Response, NextFunction } from 'express';

/**
 * UUID validation regex (v4 format)
 * Matches: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * where x is any hexadecimal digit and y is one of 8, 9, A, or B
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Middleware to validate UUID parameters in the route
 * @param paramName - The name of the parameter to validate (defaults to 'id')
 */
export const validateUuid = (paramName: string = 'id') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const paramValue = req.params[paramName];

    if (!paramValue) {
      return res.status(400).json({
        success: false,
        error: `Parameter '${paramName}' is required`,
      });
    }

    if (!UUID_REGEX.test(paramValue)) {
      return res.status(400).json({
        success: false,
        error: `Invalid UUID format for parameter '${paramName}'`,
      });
    }

    next();
  };
};
