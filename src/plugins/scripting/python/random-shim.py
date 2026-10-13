# Checked `random` library, backed by the browser Math API.

class __HvyRandomModule__:
    def random(self):
        return __hvy_window__.Math.random()

    def choice(self, sequence):
        size = len(sequence)
        if size == 0:
            raise IndexError("Cannot choose from an empty sequence")
        return sequence[int(__hvy_window__.Math.floor(self.random() * size))]

    def randrange(self, start, stop=None, step=1):
        if stop is None:
            stop = start
            start = 0
        if not isinstance(start, int) or not isinstance(stop, int) or not isinstance(step, int):
            raise TypeError("non-integer arg for randrange()")
        if step == 0:
            raise ValueError("zero step for randrange()")
        values = range(start, stop, step)
        size = len(values)
        if size == 0:
            raise ValueError("empty range for randrange()")
        return values[int(__hvy_window__.Math.floor(self.random() * size))]

    def randint(self, a, b):
        return self.randrange(a, b + 1)

    def uniform(self, a, b):
        return a + (b - a) * self.random()

    def shuffle(self, items):
        index = len(items) - 1
        while index > 0:
            swap_index = int(__hvy_window__.Math.floor(__hvy_window__.Math.random() * (index + 1)))
            temp = items[index]
            items[index] = items[swap_index]
            items[swap_index] = temp
            index -= 1

    def sample(self, population, k):
        if not isinstance(k, int):
            raise TypeError("sample counts must be integers")
        size = len(population)
        if k < 0 or k > size:
            raise ValueError("Sample larger than population or is negative")
        pool = [population[index] for index in range(size)]
        result = []
        for index in range(k):
            swap_index = index + int(__hvy_window__.Math.floor(self.random() * (size - index)))
            result.append(pool[swap_index])
            pool[swap_index] = pool[index]
        return result

    def choices(self, population, weights=None, *, cum_weights=None, k=1):
        if not isinstance(k, int):
            raise TypeError("the number of choices must be an integer")
        size = len(population)
        if size == 0:
            raise IndexError("Cannot choose from an empty sequence")
        if weights is not None and cum_weights is not None:
            raise TypeError("Cannot specify both weights and cumulative weights")
        if weights is None and cum_weights is None:
            return [self.choice(population) for _ in range(k)]

        if cum_weights is None:
            cumulative = []
            total = 0
            for weight in weights:
                total += weight
                cumulative.append(total)
        else:
            cumulative = list(cum_weights)
        if len(cumulative) != size:
            raise ValueError("The number of weights does not match the population")
        total = cumulative[-1] + 0.0
        if total <= 0.0:
            raise ValueError("Total of weights must be greater than zero")
        if not __hvy_window__.Number.isFinite(total):
            raise ValueError("Total of weights must be finite")

        result = []
        for _ in range(k):
            target = self.random() * total
            low = 0
            high = size - 1
            while low < high:
                middle = (low + high) // 2
                if target < cumulative[middle]:
                    high = middle
                else:
                    low = middle + 1
            result.append(population[low])
        return result
