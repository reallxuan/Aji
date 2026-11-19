//! Fits the main window to the screen it opens on.

/// Each side is the smaller of its default and the work area, but no smaller than the minimum.
/// All sizes are logical pixels.
pub fn fit_window(default: (f64, f64), min: (f64, f64), work_area: (f64, f64)) -> (f64, f64) {
    (
        default.0.min(work_area.0).max(min.0),
        default.1.min(work_area.1).max(min.1),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT: (f64, f64) = (1440.0, 900.0);
    const MIN: (f64, f64) = (1024.0, 640.0);

    #[test]
    fn shrinks_to_a_small_work_area() {
        assert_eq!(fit_window(DEFAULT, MIN, (1280.0, 688.0)), (1280.0, 688.0));
    }

    #[test]
    fn keeps_the_default_on_a_big_screen() {
        assert_eq!(fit_window(DEFAULT, MIN, (2560.0, 1400.0)), DEFAULT);
    }

    #[test]
    fn never_goes_below_the_minimum() {
        assert_eq!(fit_window(DEFAULT, MIN, (800.0, 600.0)), MIN);
    }
}
