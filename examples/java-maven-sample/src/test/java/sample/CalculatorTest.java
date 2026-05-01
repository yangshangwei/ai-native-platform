package sample;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class CalculatorTest {

  @Test
  public void addsPositiveNumbers() {
    assertEquals(5, Calculator.add(2, 3));
  }

  @Test
  public void multipliesPositiveNumbers() {
    assertEquals(12, Calculator.multiply(3, 4));
  }

  @Test
  public void addHandlesNegatives() {
    assertEquals(-1, Calculator.add(2, -3));
  }
}
