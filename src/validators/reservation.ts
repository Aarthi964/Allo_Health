import { z } from 'zod';

export const createReservationSchema = z.object({
  productId: z.string().uuid({ message: "Invalid product ID format. Must be a UUID." }),
  warehouseId: z.string().uuid({ message: "Invalid warehouse ID format. Must be a UUID." }),
  quantity: z
    .number({
      error: (issue) => {
        if (issue.received === 'undefined') {
          return 'Quantity is required.';
        }
        return 'Quantity must be a number.';
      }
    })
    .int({ message: "Quantity must be a whole number." })
    .positive({ message: "Quantity must be greater than 0." })
    .max(100, { message: "Maximum quantity per reservation is 100." }),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
